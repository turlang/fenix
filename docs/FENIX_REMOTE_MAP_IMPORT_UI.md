# Scene Manager — origem do mapa

No Fênix VTT, o botão **+ Mapa** oferece duas origens:

- **Arquivo** — upload local de PNG/JPG/WEBP;
- **URL** — importação de uma URL direta HTTP/HTTPS para PNG/JPG/WEBP.

No modo URL o Mestre informa nome, endereço, tamanho inicial da grade e descrição. O Engine detecta automaticamente largura e altura da imagem importada.

A interface exibe `Importando URL…` durante o download. Erros seguros do Engine, como `REMOTE_MAP_PRIVATE_HOST_FORBIDDEN`, `REMOTE_MAP_TIMEOUT`, `REMOTE_MAP_TOO_LARGE` e `REMOTE_MAP_SIGNATURE_INVALID`, aparecem no mesmo painel de erro operacional usado pelas demais ações do VTT.

A cena criada usa o asset local do Fênix. Pan, zoom e calibração de grade continuam funcionando da mesma forma que em mapas enviados por arquivo.