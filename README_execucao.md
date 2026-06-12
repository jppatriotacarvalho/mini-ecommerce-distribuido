# Mini E-commerce Distribuído — Instruções de Execução

## Pré-requisitos
- Node.js 18+ instalado
- npm instalado

## Como rodar o projeto

Abra **5 terminais separados** a partir da pasta raiz do projeto:

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

**PowerShell (Windows):**
```powershell
cd products
$env:PORT=5012; node index.js
```

**Bash (Linux/Mac):**
```bash
cd products
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
Abra no navegador: http://localhost:5000/dashboard

---

## Endpoints disponíveis (via Gateway na porta 5000)

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| POST | /users/register | Não | Registrar usuário |
| POST | /users/login | Não | Login e obter JWT |
| GET | /users/:id | JWT | Buscar usuário |
| GET | /products | Não | Listar produtos |
| GET | /products/:id | Não | Detalhar produto |
| POST | /products | JWT (admin) | Criar produto |
| POST | /orders | JWT | Criar pedido |
| GET | /orders/:userId | JWT | Listar pedidos do usuário |
| GET | /health | Não | Status dos serviços |
| GET | /dashboard | Não | Dashboard de monitoramento |

---

## Exemplos de teste com curl

### 1. Registrar usuário comum
```bash
curl -X POST http://localhost:5000/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"João","email":"joao@email.com","password":"123456"}'
```

### 2. Registrar usuário administrador
```bash
curl -X POST http://localhost:5000/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@email.com","password":"admin123","role":"admin"}'
```

### 3. Login (obter JWT)
```bash
curl -X POST http://localhost:5000/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@email.com","password":"admin123"}'
```
> Copie o `token` retornado para usar nas próximas requisições.

### 4. Buscar usuário por ID (requer JWT)
```bash
curl http://localhost:5000/users/<USER_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 5. Criar produto (requer JWT de admin)
```bash
curl -X POST http://localhost:5000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_ADMIN>" \
  -d '{"name":"Notebook","price":2500.00,"description":"Notebook i7","stock":10}'
```

### 6. Tentar criar produto com JWT de usuário comum (deve retornar 403)
```bash
curl -X POST http://localhost:5000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_USER>" \
  -d '{"name":"Produto","price":100}'
```

### 7. Listar produtos
```bash
curl http://localhost:5000/products
```

### 8. Criar pedido (requer JWT)
```bash
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"productId":"<PRODUCT_ID>"}'
```

### 9. Listar pedidos do usuário
```bash
curl http://localhost:5000/orders/<USER_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 10. Verificar status dos serviços
```bash
curl http://localhost:5000/health
```

---

## Testando Tolerância a Falhas e Replicação

### Cenário: Réplica cai e volta ao ar com dados sincronizados

1. Com todos os 5 serviços rodando, crie um produto via POST /products (passo 5 acima).
2. Pare o Terminal 3 (réplica 5012): `Ctrl+C`.
3. Crie mais 2 produtos. Eles vão para 5002 (5012 está fora).
4. Reinicie o Terminal 3 (`$env:PORT=5012; node index.js`).
5. Aguarde ~5 segundos (próximo heartbeat).
6. O gateway detecta a recuperação → **sincroniza automaticamente** os produtos perdidos para 5012.
7. Verifique: `curl http://localhost:5012/products` deve mostrar todos os produtos.

### Cenário: Serviço fora retorna 503

1. Pare o Terminal 1 (users 5001).
2. Aguarde 2 heartbeats (~10 segundos).
3. Tente `POST /users/register` → deve retornar `503 Serviço de usuários indisponível`.

### Cenário: 401 sem token e 403 sem permissão

```bash
# 401 — sem token
curl -X POST http://localhost:5000/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Teste","price":10}'

# 403 — token de usuário comum tentando criar produto
curl -X POST http://localhost:5000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_USER>" \
  -d '{"name":"Teste","price":10}'
```
