# Dev troubleshooting

Snippet pratici per problemi ricorrenti durante lo sviluppo locale su Windows
(PowerShell). Tieni a portata di mano: porte occupate, processi orfani, cache
strane.

## Porte tipiche del progetto

| Porta | Servizio                           |
| ----- | ---------------------------------- |
| 3000  | Next.js (`apps/web`)               |
| 3001  | NestJS (`apps/api`)                |
| 5432  | Postgres (Docker Compose)          |
| 8080  | Adminer (Docker Compose)           |

## Porta già in uso (`EADDRINUSE`)

Sintomo tipico:

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3001
```

Significa che un processo è ancora in ascolto sulla porta — di solito un
`pnpm dev` di una sessione precedente che non si è chiuso, o un `node.exe`
orfano.

### 1. Vedere chi occupa la porta

```powershell
Get-NetTCPConnection -LocalPort 3001 | Select-Object LocalPort, OwningProcess, @{N="Process";E={(Get-Process -Id $_.OwningProcess).ProcessName}}
```

Output atteso:

```
LocalPort OwningProcess Process
--------- ------------- -------
     3001         12345 node
```

### 2. Killare il processo

Sostituisci `12345` col PID che vedi sopra:

```powershell
Stop-Process -Id 12345 -Force
```

### One-liner: trova e killa in un colpo solo

```powershell
Get-NetTCPConnection -LocalPort 3001 |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Stessa cosa per la porta 3000 (web) — basta cambiare `-LocalPort`.

## Killare tutti i processi Node orfani

Se hai più finestre `pnpm dev` chiuse male e non sai bene quale processo è
quale, puoi fare piazza pulita:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

Attenzione: chiude **ogni** processo Node sulla macchina, inclusi eventuali
editor / tool che usano Node sotto. Usalo solo se sei sicuro di non avere
altro che gira.

## Postgres non risponde

Verifica che il container sia su:

```powershell
docker compose ps
```

Se è giù:

```powershell
docker compose up -d postgres
```

Per resettare completamente lo stato del DB (cancella tutti i dati):

```powershell
docker compose down -v
docker compose up -d postgres
pnpm --filter @reservation/api prisma migrate dev
pnpm --filter @reservation/api prisma db seed
```

## Prisma client non aggiornato

Se hai cambiato `schema.prisma` e l'API si lamenta di tipi mancanti:

```powershell
pnpm --filter @reservation/api prisma generate
```

## Cache Next.js sporca

Comportamenti strani solo in dev (HMR confuso, vecchio bundle):

```powershell
Remove-Item -Recurse -Force apps/web/.next
pnpm --filter @reservation/web dev
```
