const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'segredo_super_secreto_2024';
const DB_FILE = path.join(__dirname, 'users.json');

// Inicializa banco de dados
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

function getUsers() {
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveUsers(users) {
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'users', port: PORT });
});

// Registrar usuário
app.post('/users/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    const users = getUsers();
    if (users.find(u => u.email === email)) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(),
      name,
      email,
      password: hashedPassword,
      role: role || 'user',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json({ message: 'Usuário criado com sucesso', user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Login
app.post('/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const users = getUsers();
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ message: 'Login realizado com sucesso', token });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar usuário por ID (requer JWT)
app.get('/users/:id', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET);

    const users = getUsers();
    const user = users.find(u => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Serviço de Usuários rodando na porta ${PORT}`);
});