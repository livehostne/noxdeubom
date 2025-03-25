const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Configurar fuso horário para Brasília/São Paulo
process.env.TZ = 'America/Sao_Paulo';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Conexão com MongoDB
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  try {
    const db = await mongoose.connect('mongodb+srv://nox:9agos2010@cluster0.p8e2u.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
    cachedDb = db;
    console.log('Conectado ao MongoDB');
    return db;
  } catch (err) {
    console.error('Erro ao conectar ao MongoDB:', err);
    throw err;
  }
}

// Função para obter data no fuso horário de SP
function getBrasiliaTime() {
  return new Date();
}

// Função para formatar data para exibição
function formatarData(date) {
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Função para extrair tipo MIME da string base64
function getMimeType(base64String) {
  try {
    return base64String.match(/data:(.*?);/)[1];
  } catch (error) {
    return 'image/png'; // Tipo padrão se não conseguir detectar
  }
}

// Modelo da imagem
const imageSchema = new mongoose.Schema({
  data: {
    type: String,
    required: [true, 'Dados da imagem são obrigatórios']
  },
  mimeType: {
    type: String,
    required: true
  },
  createdAt: { 
    type: Date,
    default: getBrasiliaTime,
    expires: 18000 // 5 horas em segundos
  }
});

const Image = mongoose.models.Image || mongoose.model('Image', imageSchema);

// Middleware para validar base64
function validarBase64(base64String) {
  if (!base64String) return false;
  try {
    // Verifica se começa com data:image
    if (!base64String.startsWith('data:image')) {
      return false;
    }
    // Verifica se contém ;base64,
    if (!base64String.includes(';base64,')) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Middleware para garantir conexão com o banco
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao conectar ao banco de dados' });
  }
});

// Rota para verificar se a API está online
app.get('/', (req, res) => {
  res.json({ status: 'API Online', hora: formatarData(getBrasiliaTime()) });
});

// Rota para upload de imagem
app.post('/upload', async (req, res) => {
  try {
    const { img } = req.body;
    
    if (!img) {
      return res.status(400).json({ error: 'Nenhuma imagem fornecida' });
    }

    const image = new Image({
      data: img,
      createdAt: getBrasiliaTime()
    });

    await image.save();

    const imageUrl = `${req.protocol}://${req.get('host')}/image/${image._id}`;
    res.json({ 
      url: imageUrl,
      expiraEm: new Date(image.createdAt.getTime() + 18000000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
  }
});

// Rota para obter imagem
app.get('/image/:id', async (req, res) => {
  try {
    console.log('Buscando imagem:', req.params.id);
    const image = await Image.findById(req.params.id);
    
    if (!image) {
      console.log('Imagem não encontrada:', req.params.id);
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }

    // Extrai apenas os dados da imagem (remove o prefixo data:image/xyz;base64,)
    const imageData = image.data.split(',')[1];
    const buffer = Buffer.from(imageData, 'base64');

    // Define o tipo de conteúdo correto
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=18000'); // 5 horas de cache
    res.send(buffer);
  } catch (error) {
    console.error('Erro ao buscar imagem:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar imagem',
      detalhes: error.message 
    });
  }
});

// Rota para upload via query parameter
app.get('/api.img', async (req, res) => {
  try {
    console.log('Recebendo requisição de upload...');
    const { img } = req.query;
    
    if (!img) {
      console.log('Nenhuma imagem fornecida no request');
      return res.status(400).json({ error: 'Nenhuma imagem fornecida' });
    }

    if (!validarBase64(img)) {
      console.log('Formato de imagem inválido');
      return res.status(400).json({ error: 'Formato de imagem inválido. Deve ser uma string base64 válida começando com data:image' });
    }

    console.log('Criando novo documento de imagem...');
    const now = getBrasiliaTime();
    const image = new Image({
      data: img,
      mimeType: getMimeType(img),
      createdAt: now
    });

    console.log('Salvando imagem no MongoDB...');
    await image.save();

    const imageUrl = `${req.protocol}://${req.get('host')}/image/${image._id}`;
    console.log('Imagem salva com sucesso:', imageUrl);
    
    res.json({ 
      url: imageUrl,
      expiraEm: formatarData(new Date(now.getTime() + 18000000))
    });
  } catch (error) {
    console.error('Erro detalhado:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Erro de validação',
        detalhes: error.message 
      });
    }
    
    if (error.name === 'MongoServerError') {
      return res.status(500).json({ 
        error: 'Erro no banco de dados',
        detalhes: error.message 
      });
    }

    res.status(500).json({ 
      error: 'Erro ao fazer upload da imagem',
      detalhes: error.message
    });
  }
});

// Vercel requer que exportemos o app
module.exports = app;

// Se não estivermos no Vercel, iniciamos o servidor
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port} - Horário de Brasília: ${formatarData(getBrasiliaTime())}`);
  });
} 
