const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5002;
const JWT_SECRET = process.env.JWT_SECRET || 'senha12345678';
const INTERNAL_KEY = process.env.INTERNAL_KEY || 'internal-secret';
const DB_FILE = path.join(__dirname, `products_${PORT}.json`);

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'products', port: PORT });
});

app.get('/products', (req, res) => {
  res.json(getProducts());
});

app.get('/products/:id', (req, res) => {
  const products = getProducts();
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(product);
});

app.post('/products', (req, res) => {
  const decoded = verifyToken(req, res);
  if (!decoded) return;
  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem criar produtos' });
  }
  const { name, price, description, stock } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
  }
  const newProduct = {
    id: Date.now().toString(),
    name, price,
    description: description || '',
    stock: stock || 0,
    createdAt: new Date().toISOString()
  };
  const products = getProducts();
  products.push(newProduct);
  saveProducts(products);
  res.status(201).json({ message: 'Produto criado com sucesso', product: newProduct, replica: PORT });
});

app.post('/products/replicate', (req, res) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Acesso interno não autorizado' });
  }
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

app.post('/products/sync', (req, res) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Acesso interno não autorizado' });
  }
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Body deve ser um array de produtos' });
    }
    const products = getProducts();
    let added = 0;
    for (const p of incoming) {
      if (!products.find(x => x.id === p.id)) {
        products.push(p);
        added++;
      }
    }
    saveProducts(products);
    res.json({ message: `Sincronizado: ${added} produto(s) adicionado(s)` });
  } catch (error) {
    res.status(500).json({ error: 'Erro na sincronização' });
  }
});

https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`Serviço de Produtos rodando em HTTPS na porta ${PORT}`);
});