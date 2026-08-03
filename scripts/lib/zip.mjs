import { createWriteStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function normalizeEntryName(value) {
  return value.split(sep).join('/').replace(/^\/+/, '');
}

async function collectFiles(directory) {
  const root = resolve(directory);
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files.sort((left, right) => left.localeCompare(right)).map((path) => ({ path, name: normalizeEntryName(relative(root, path)) }));
}

export async function createZipFromDirectory(sourceDirectory, outputFile, { prefix = '' } = {}) {
  const files = await collectFiles(sourceDirectory);
  await mkdir(dirname(outputFile), { recursive: true });
  const output = createWriteStream(outputFile);
  const central = [];
  let offset = 0;

  const write = (buffer) => new Promise((resolvePromise, reject) => {
    output.write(buffer, (error) => error ? reject(error) : resolvePromise());
  });

  for (const file of files) {
    const content = await readFile(file.path);
    const metadata = await stat(file.path);
    const name = Buffer.from(normalizeEntryName(prefix ? `${prefix}/${file.name}` : file.name), 'utf8');
    const checksum = crc32(content);
    const { time, date } = dosDateTime(metadata.mtime);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    await write(header);
    await write(name);
    await write(content);

    central.push({ name, checksum, size: content.length, time, date, offset, mode: metadata.mode });
    offset += header.length + name.length + content.length;
  }

  const centralStart = offset;
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(entry.time, 12);
    header.writeUInt16LE(entry.date, 14);
    header.writeUInt32LE(entry.checksum, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
    header.writeUInt32LE(entry.offset, 42);
    await write(header);
    await write(entry.name);
    offset += header.length + entry.name.length;
  }

  const centralSize = offset - centralStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  await write(end);
  await new Promise((resolvePromise, reject) => output.end((error) => error ? reject(error) : resolvePromise()));
  return { outputFile, fileCount: central.length, bytes: offset + end.length };
}
