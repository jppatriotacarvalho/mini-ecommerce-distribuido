# Mini E-commerce Distribuído — Instruções de Execução

## Pré-requisitos
- Node.js 18+ instalado
- npm instalado

## Estrutura do Projeto

```
mini-ecommerce-distribuido/
├── gateway/     ← API Gateway (porta 5000, HTTPS)
├── users/       ← Serviço de Usuários (porta 5001, HTTPS)
├── products/    ← Serviço de Produtos (portas 5002 e 5012, HTTPS)
├── orders/      ← Serviço de Pedidos (porta 5003, HTTPS)
├── certs/       ← Certificados SSL (cert.pem, key.pem)
└── README_execucao.md
```

## Opção 1 — Docker Compose (Recomendado)

Com **Docker** e **Docker Compose** instalados, execute na raiz do projeto:

```bash
docker-compose up --build
```

Aguarde até aparecer no terminal:
```
API Gateway rodando em HTTPS na porta 5000
Serviço de Usuários rodando em HTTPS na porta 5001
Serviço de Produtos rodando em HTTPS na porta 5002
Serviço de Produtos rodando em HTTPS na porta 5012
Serviço de Pedidos rodando em HTTPS na porta 5003
```

Para encerrar: `docker-compose down`

---

## Opção 2 — Execução Manual (sem Docker)

Abra **5 terminais separados** e execute cada comando em um terminal:

### Terminal 1 — Serviço de Usuários (porta 5001)
```bash
cd users
npm install
node index.js
```

### Terminal 2 — Serviço de Produtos Réplica 1 (porta 5002)
```bash
cd products
npm install
node index.js
```

### Terminal 3 — Serviço de Produtos Réplica 2 (porta 5012)
```bash
cd products
# PowerShell:
$env:PORT=5012; node index.js
# Linux/Mac:
PORT=5012 node index.js
```

### Terminal 4 — Serviço de Pedidos (porta 5003)
```bash
cd orders
npm install
node index.js
```

### Terminal 5 — API Gateway (porta 5000)
```bash
cd gateway
npm install
node index.js
```

## Acessar o Dashboard
Abra no navegador: **https://localhost:5000/dashboard**

> O navegador vai mostrar um aviso de certificado autoassinado. Clique em "Avançado" e depois "Prosseguir para localhost".

---

## Testando com PowerShell

### IMPORTANTE — Executar antes de qualquer teste
```powershell
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing'] = $true
```
> Esses comandos fazem o PowerShell ignorar a validação do certificado autoassinado. São necessários porque o certificado SSL não foi emitido por uma autoridade reconhecida (é autoassinado para fins acadêmicos).

---

### Registrar usuário
```powershell
curl -Method POST https://localhost:5000/users/register -ContentType "application/json" -Body '{"name":"Admin","email":"admin@email.com","password":"123456"}'
```

> **Para testar criação de produtos (role admin):** após registrar, edite o arquivo `users/users.json` e altere `"role": "user"` para `"role": "admin"` no usuário criado. Depois faça login novamente para obter um token com role admin.

### Login e obter token JWT
```powershell
$response = curl -Method POST https://localhost:5000/users/login -ContentType "application/json" -Body '{"email":"admin@email.com","password":"123456"}'
$token = ($response.Content | ConvertFrom-Json).token
echo $token
```

### Criar produto (requer token admin)
```powershell
curl -Method POST https://localhost:5000/products -ContentType "application/json" -Headers @{Authorization="Bearer $token"} -Body '{"name":"Notebook","price":2500,"description":"Notebook gamer","stock":10}'
```

### Listar produtos
```powershell
curl https://localhost:5000/products
```

### Criar pedido
```powershell
curl -Method POST https://localhost:5000/orders -ContentType "application/json" -Headers @{Authorization="Bearer $token"} -Body '{"productId":"ID_DO_PRODUTO"}'
```

---

## Testando Tolerância a Falhas (Auto-Sync)

1. Com todos os serviços rodando, derrube a réplica 5012 (Ctrl+C no Terminal 3)
2. Crie novos produtos normalmente — o sistema continua funcionando via réplica 5002
3. Suba a réplica novamente no Terminal 3: `$env:PORT=5012; node index.js`
4. Aguarde até 10 segundos — o gateway detecta a recuperação e sincroniza automaticamente os dados perdidos
5. Verifique no terminal do gateway a mensagem: `[SYNC] Porta 5012: X produto(s) adicionado(s)`

---

## Testando Segurança JWT

### Sem token — deve retornar 401
```powershell
curl -Method POST https://localhost:5000/products -ContentType "application/json" -Body '{"name":"Teste","price":100}'
```

### Usuário comum tentando criar produto — deve retornar 403
```powershell
curl -Method POST https://localhost:5000/users/register -ContentType "application/json" -Body '{"name":"User","email":"user@email.com","password":"123456"}'
$response2 = curl -Method POST https://localhost:5000/users/login -ContentType "application/json" -Body '{"email":"user@email.com","password":"123456"}'
$tokenUser = ($response2.Content | ConvertFrom-Json).token
curl -Method POST https://localhost:5000/products -ContentType "application/json" -Headers @{Authorization="Bearer $tokenUser"} -Body '{"name":"Teste","price":100}'
```

---

## Endpoints Disponíveis (via Gateway HTTPS porta 5000)

| Método | Endpoint | Autenticação | Descrição |
|--------|----------|--------------|-----------|
| POST | /users/register | Não | Registrar usuário |
| POST | /users/login | Não | Login e obter JWT |
| GET | /users/:id | JWT | Buscar usuário |
| GET | /products | Não | Listar produtos |
| GET | /products/:id | Não | Detalhar produto |
| POST | /products | JWT admin | Criar produto |
| POST | /orders | JWT | Criar pedido |
| GET | /orders/:userId | JWT | Listar pedidos |
| GET | /health | Não | Status dos serviços |
| GET | /dashboard | Não | Dashboard de monitoramento |

---

## Observações Técnicas
- Todos os serviços usam **HTTPS** com certificado SSL autoassinado (bônus)
- O certificado está em `certs/cert.pem` e `certs/key.pem`
- No PowerShell, é necessário desabilitar a validação SSL com o comando indicado acima
- No navegador, aceite o aviso de segurança clicando em "Avançado > Prosseguir"