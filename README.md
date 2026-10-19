# backloggd-tracker

Registra automaticamente no [Backloggd](https://backloggd.com) as sessões dos jogos que você joga no Windows ou no Linux.

- Abriu o jogo: ele vai para a prateleira **playing**.
- Fechou o jogo: a sessão (data e duração) entra no diário do jogo, e aparece uma notificação.
- Funciona com qualquer jogo (Steam, Epic, emulador, executável solto, Wine/Proton), porque olha os processos do sistema em vez de uma loja.

> Projeto não oficial, sem vínculo com o Backloggd. O Backloggd não tem API pública: este projeto usa os endpoints internos do site, via [backloggd-mcp](https://github.com/DenisionSoft/backloggd-mcp), e pode quebrar quando o site mudar.

## Requisitos

- Windows ou Linux
- Node.js 20 ou mais novo (no Windows: `winget install OpenJS.NodeJS.LTS`)
- Linux: `notify-send` (pacote `libnotify`) para as notificações

## Instalação

```sh
git clone https://github.com/FelipeMayerDev/backloggd-tracker
cd backloggd-tracker
npm ci
cp .env.example .env              # Windows: copy .env.example .env
cp games.example.json games.json  # Windows: copy games.example.json games.json
```

### 1. Login do Backloggd (`.env`)

O jeito que funciona para qualquer conta é o cookie de sessão:

1. Abra backloggd.com logado no navegador.
2. Aperte F12, abra **Application** > **Cookies** > `https://backloggd.com`.
3. Copie o valor de `_backloggd_session` para `BACKLOGGD_SESSION=` no `.env`.

O cookie expira com o tempo. Quando isso acontecer, aparece uma notificação "Falha ao salvar sessão". É só copiar um cookie novo.

Usuário e senha também funcionam (`BACKLOGGD_USERNAME` / `BACKLOGGD_PASSWORD`), mas não em contas criadas com login do Google, Discord ou Steam.

### 2. Jogos (`games.json`)

Liste o executável de cada jogo e o título dele no Backloggd:

```json
{
  "CONTROLResonant.exe": "Control Resonant",
  "eldenring.exe": "Elden Ring"
}
```

Para descobrir o nome do executável:

- **Windows:** abra o jogo e procure no Gerenciador de Tarefas, aba Detalhes.
- **Linux:** abra o jogo e rode `ps -eo args | grep -i <parte do nome>`. Em jogos rodando por Wine/Proton, use o `.exe` do Windows mesmo. Em jogos nativos, use o nome do binário.

O mesmo `games.json` serve para os dois sistemas. Use o título exatamente como aparece no Backloggd, para não pegar o jogo errado.

### 3. Rodar

```sh
npm start
```

Depois de editar o `games.json` ou o `.env`, reinicie o tracker.

**Iniciar com o Windows:** crie um atalho para `start-tracker.vbs` em `shell:startup` (Win+R, digite `shell:startup`). O tracker roda escondido, e a saída vai para `tracker.log`.

**Iniciar com o Linux** (systemd): ajuste o `WorkingDirectory` em `backloggd-tracker.service` e rode:

```sh
cp backloggd-tracker.service ~/.config/systemd/user/
systemctl --user enable --now backloggd-tracker
journalctl --user -u backloggd-tracker -f   # logs
```

## Como funciona

A cada minuto, o tracker lista os processos (`tasklist` no Windows, `ps` no Linux) e confere se algum executável do `games.json` está aberto.

- Sessões com menos de 5 minutos são ignoradas (ajuste com `MIN_MINUTES` no `.env`).
- A sessão termina na última checagem em que o jogo ainda estava aberto, então reiniciar o PC ou o tracker não aumenta o tempo registrado.
- A sessão em andamento fica em `state.json`, o que permite retomar a contagem depois de um reinício.
- Se o jogo ainda não tem log no Backloggd, o tracker cria um playthrough antes de gravar a sessão.
- Se der para salvar, aparece uma notificação. Se não der, a sessão completa fica no log para você lançar à mão.

## Sobre `vendor/`

`vendor/backloggd-mcp-0.1.1-patched.tgz` é o [backloggd-mcp](https://github.com/DenisionSoft/backloggd-mcp) (MIT) já compilado, com uma correção: o Backloggd passou a mandar o status das sessões como número (`5`) em vez de texto (`"played"`). Sem a correção, a leitura do diário quebrava, e salvar uma sessão nova apagaria o status das sessões antigas. A correção está em `dist/parse/library.js` e `dist/parse/sessions.js`.

## Testes

```powershell
npm test
```
