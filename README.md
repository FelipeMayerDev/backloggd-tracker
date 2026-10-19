# backloggd-tracker

Registra automaticamente no [Backloggd](https://backloggd.com) as sessões dos jogos que você joga no Windows ou no Linux.

- Abriu o jogo: ele vai para a prateleira **playing**.
- Fechou o jogo: a sessão (data e duração) entra no diário do jogo, e aparece uma notificação.
- O jogo é reconhecido sozinho, sem cadastro: Steam, Epic, GOG, Riot, Xbox, Wine/Proton, ou qualquer pasta com "Games" ou "Jogos" no nome. Emuladores não são reconhecidos.

> Projeto não oficial, sem vínculo com o Backloggd. O Backloggd não tem API pública: este projeto usa os endpoints internos do site, via [backloggd-mcp](https://github.com/DenisionSoft/backloggd-mcp), e pode quebrar quando o site mudar.

## Download para Windows (sem instalar nada)

Baixe o `backloggd-tracker-windows.zip` na página de [Releases](https://github.com/FelipeMayerDev/backloggd-tracker/releases), extraia e siga o `LEIA-ME.txt` que vem dentro. O `.exe` já traz o Node embutido, roda sem janela e pode ser colocado no `shell:startup`.

O resto deste README é para quem quer rodar a partir do código-fonte (Windows ou Linux).

## Requisitos

- Windows ou Linux
- Node.js 20 ou mais novo (no Windows: `winget install OpenJS.NodeJS.LTS`)
- Linux: `notify-send` (pacote `libnotify`) para as notificações

## Instalação

```sh
git clone https://github.com/FelipeMayerDev/backloggd-tracker
cd backloggd-tracker
npm ci
cp .env.example .env   # Windows: copy .env.example .env
```

### 1. Login do Backloggd (`.env`)

O jeito que funciona para qualquer conta é o cookie de sessão:

1. Abra backloggd.com logado no navegador.
2. Aperte F12, abra **Application** > **Cookies** > `https://backloggd.com`.
3. Copie o valor de `_backloggd_session` para `BACKLOGGD_SESSION=` no `.env`.

O cookie expira com o tempo. Quando isso acontecer, aparece uma notificação "Falha ao salvar sessão". É só copiar um cookie novo.

Usuário e senha também funcionam (`BACKLOGGD_USERNAME` / `BACKLOGGD_PASSWORD`), mas não em contas criadas com login do Google, Discord ou Steam.

### 2. Rodar

```sh
npm start
```

Depois de editar o `.env` ou o `games.json`, reinicie o tracker.

**Iniciar com o Windows:** crie um atalho para `start-tracker.vbs` em `shell:startup` (Win+R, digite `shell:startup`). O tracker roda escondido, e a saída vai para `tracker.log`.

**Iniciar com o Linux** (systemd): ajuste o `WorkingDirectory` em `backloggd-tracker.service` e rode:

```sh
cp backloggd-tracker.service ~/.config/systemd/user/
systemctl --user enable --now backloggd-tracker
journalctl --user -u backloggd-tracker -f   # logs
```

## Como funciona

A cada minuto, o tracker lista os processos em execução, pelo caminho completo no Windows e pela linha de comando no Linux, o que inclui jogos rodando por Wine/Proton. Para cada processo, ele tenta achar o nome do jogo assim:

1. **Pasta de instalação.** Para jogos da Steam (`steamapps/common/<pasta>`), o nome oficial vem do `appmanifest` da Steam. Fora da Steam, vale a pasta logo abaixo de qualquer diretório com "games" ou "jogos" no nome: `Epic Games\X`, `GOG Games\X`, `Riot Games\X`, `XboxGames\X`, `D:\Jogos\X`.
2. **Confirmação no Backloggd.** O nome é buscado no próprio Backloggd, cuja base vem do IGDB, e só conta se bater **exatamente** com o título de um jogo, ignorando maiúsculas, acentos e pontuação. Isso evita duas coisas: gravar a sessão no jogo errado por causa de uma busca aproximada, e tratar programas comuns como jogo. Por exemplo, "Riot Client" e "Epic Online Services" ficam de fora.

Jogos instalados fora dessas pastas não são reconhecidos. Para eles, e para corrigir qualquer erro, crie um `games.json` (veja `games.example.json`). Nele, cada nome de `.exe` aponta para o título correto no Backloggd, ou para `null` se deve ser ignorado.

Além disso:


- Sessões com menos de 5 minutos são ignoradas (ajuste com `MIN_MINUTES` no `.env`).
- A sessão termina na última checagem em que o jogo ainda estava aberto, então reiniciar o PC ou o tracker não aumenta o tempo registrado.
- A sessão em andamento fica em `state.json`, o que permite retomar a contagem depois de um reinício.
- Se o jogo ainda não tem log no Backloggd, o tracker cria um playthrough antes de gravar a sessão.
- Se der para salvar, aparece uma notificação. Se não der, a sessão completa fica no log para você lançar à mão.

## Sobre `vendor/`

`vendor/backloggd-mcp-0.1.1-patched.tgz` é o [backloggd-mcp](https://github.com/DenisionSoft/backloggd-mcp) (MIT) já compilado, com uma correção: o Backloggd passou a mandar o status das sessões como número (`5`) em vez de texto (`"played"`). Sem a correção, a leitura do diário quebrava, e salvar uma sessão nova apagaria o status das sessões antigas. A correção está em `dist/parse/library.js` e `dist/parse/sessions.js`.

## Testes

```sh
npm test
```

## Gerar o executável

```sh
npm run build
```

Funciona em qualquer sistema. O script junta tudo num arquivo com esbuild, baixa o `node.exe` oficial da mesma versão do seu Node (conferindo o SHA-256), embute o código com `node --build-sea` e marca o `.exe` como aplicativo sem console. O resultado é `build/backloggd-tracker-windows.zip`. Precisa de um Node com `--build-sea` (testado no 26) e do `bsdtar`, que no Windows já vem como `tar`.

O `.exe` não tem assinatura digital, então o SmartScreen avisa na primeira execução.
