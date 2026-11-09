# Pacotes do Trail 1.4.8

- `trail-chrome-1.4.8.zip`: pacote de publicação para Chrome Web Store e Edge Add-ons. O `manifest.json` fica na raiz e mapas de código não são incluídos.
- `trail-extensao-1.4.8.zip`: cópia da pasta `trail-extensao/` para instalação manual em modo de desenvolvedor. Inclui `build.txt`; não deve ser enviada às lojas.

Ambos contêm o mesmo runtime 1.4.8. A diferença é somente a forma de empacotamento e o `build.txt` da instalação manual.

A 1.4.8 é atualização da 1.4.7. O `manifest.json` é igual ao da 1.4.7 fora a versão: a atualização não pede permissão nova. A 1.4.4 não deve ser publicada: para usuários sem admin ela deixava mensagens vermelhas de acesso na sessão (bateria do PDI, 24/10/2026).

## SHA-256

```text
ceaa60813c284195c8c4b16fcc500b47fb10e381c731539dabf4016ba1ff8d01  trail-chrome-1.4.8.zip
fb27171d24555741bddf838099f7503925cd6bfaa2eb3f1adf55bac52e11daa9  trail-extensao-1.4.8.zip
```
