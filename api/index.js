require('dotenv').config();
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const bcrypt = require('bcrypt');
const mongoosePaginate = require('mongoose-paginate-v2');

const app = express();

// Enhanced CORS Configuration
const vercelPattern = /https:\/\/realform-.*-abrahams-projects-dd6fb99d\.vercel\.app/;

app.use(cors({
    origin: (origin, callback) => {
        if (
            !origin || // Allow non-browser clients
            vercelPattern.test(origin) || // Match Vercel pattern
            origin === 'https://realform-4g8155rbf-abrahams-projects-dd6fb99d.vercel.app'
        ) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin'],
    credentials: true,
    optionsSuccessStatus: 204
}));

app.options('*', cors()); // Handle preflight requests

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Database Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Schema and Model
const registrationSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, required: true },
    biography: String,
    profilePicture: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

registrationSchema.plugin(mongoosePaginate);
const Registration = mongoose.model('Registration', registrationSchema);

// Middleware
const upload = multer({ storage: multer.memoryStorage() });
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/views/index.html'));
});

app.get('/view-registration', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/views/view-registration.html'));
});

// Registration Endpoint
app.post('/register', upload.single('profilePicture'), async (req, res) => {
    try {
        // File Validation
        if (!req.file) return res.status(400).json({ error: 'Profile picture required' });
        if (!['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
            return res.status(400).json({ error: 'Only JPEG/PNG allowed' });
        }

        // Cloudinary Upload
        const dataURI = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        const cloudResult = await cloudinary.uploader.upload(dataURI, {
            folder: 'profile-pictures',
            public_id: uuidv4(),
            overwrite: false
        });

        // Create User
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new Registration({
            ...req.body,
            password: hashedPassword,
            profilePicture: cloudResult.secure_url,
            dateOfBirth: new Date(req.body.dateOfBirth)
        });

        await newUser.save();
        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        const status = error.code === 11000 ? 409 : 500;
        res.status(status).json({ error: error.message });
    }
});

// Admin Endpoints
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const [username, password] = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');
    
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
    res.status(401).json({ error: 'Authentication required' });
};

app.get('/api/registrations', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const result = await Registration.paginate({}, {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 },
            lean: true
        });
        res.json(result);
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/registration/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        const deletedUser = await Registration.findByIdAndDelete(id);
        if (!deletedUser) return res.status(404).json({ error: 'User not found' });
        
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));