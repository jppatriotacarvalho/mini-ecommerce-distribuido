const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5002;
const JWT_SECRET = process.env.JWT_SECRET || 'segredo_super_secreto_2024';
const DB_FILE = path.join(__dirname, `products_${PORT}.json`);

// Inicializa banco de dados da réplica
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

function getProducts() {
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveProducts(products) {
  fs.writeFileSync(DB_FILE, JSON.stringify(products, null, 2));
}

function verifyToken(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token não fornecido' });
    return null;
  }
  try {
    const token = authHeader.split(' ')[1];
    return jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
    return null;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'products', port: PORT });
});

// Listar produtos
app.get('/products', (req, res) => {
  const products = getProducts();
  res.json(products);
});

// Detalhar produto
app.get('/products/:id', (req, res) => {
  const products = getProducts();
  const product = products.find(p => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }
  res.json(product);
});

// Criar produto (requer JWT de admin)
app.post('/products', async (req, res) => {
  const decoded = verifyToken(req, res);
  if (!decoded) return;

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem criar produtos' });
  }

  try {
    const { name, price, description, stock } = req.body;
    if (!name || !price) {
      return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
    }

    const newProduct = {
      id: Date.now().toString(),
      name,
      price,
      description: description || '',
      stock: stock || 0,
      createdAt: new Date().toISOString()
    };

    const products = getProducts();
    products.push(newProduct);
    saveProducts(products);

    res.status(201).json({ message: 'Produto criado com sucesso', product: newProduct, replica: PORT });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint interno de replicação
app.post('/products/replicate', (req, res) => {
  try {
    const product = req.body;
    const products = getProducts();
    if (!products.find(p => p.id === product.id)) {
      products.push(product);
      saveProducts(products);
    }
    res.json({ message: 'Replicado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro na replicação' });
  }
});

// Sincronização em massa — chamada pelo gateway após réplica retornar ao ar
app.post('/products/sync', (req, res) => {
  try {
    const { products: incoming } = req.body;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'products deve ser um array' });
    }
    const current = getProducts();
    let synced = 0;
    for (const p of incoming) {
      if (!current.find(x => x.id === p.id)) {
        current.push(p);
        synced++;
      }
    }
    if (synced > 0) saveProducts(current);
    console.log(`[${new Date().toISOString()}] [SYNC] Porta ${PORT}: ${synced} produto(s) adicionado(s) na sincronização`);
    res.json({ message: 'Sincronização concluída', synced });
  } catch (error) {
    res.status(500).json({ error: 'Erro na sincronização' });
  }
});

app.listen(PORT, () => {
  console.log(`Serviço de Produtos rodando na porta ${PORT}`);
});