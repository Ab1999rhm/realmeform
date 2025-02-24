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

// Enable CORS for all routes
const allowedOrigins = [
    'https://realform-git-main-abrahams-projects-dd6fb99d.vercel.app',
    'https://realform-4g8155rbf-abrahams-projects-dd6fb99d.vercel.app',
    'https://realform-hjc2r87jy-abrahams-projects-dd6fb99d.vercel.app',
    'https://realmeform.vercel.app'
];

app.use(cors({
    origin: function (origin, callback) {
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true
}));

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// Schema and Model
const registrationSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, required: true },
    biography: { type: String },
    profilePicture: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

registrationSchema.plugin(mongoosePaginate);

const Registration = mongoose.model('Registration', registrationSchema);

// Configure Multer
const upload = multer({ storage: multer.memoryStorage() });

// Middleware with increased body size limit
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Test route to ensure server is working
app.get('/test', (req, res) => {
    res.send('Server is working!');
});

// Admin Authentication (with logging)
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const [username, password] = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');

    console.log(`Username: ${username}, Password: ${password}`);  // Add this line for debugging

    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
    res.status(401).json({ error: 'Authentication required' });
};

// Root route to serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/views/index.html'));
});

app.get('/view-registration', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/views/view-registration.html'));
});

// Registration Endpoint with Cloudinary
app.post('/register', upload.single('profilePicture'), async (req, res) => {
    try {
        // Validation
        if (!req.file) return res.status(400).json({ error: 'Profile picture required' });
        if (!['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
            return res.status(400).json({ error: 'Only JPEG/PNG allowed' });
        }

        // Convert buffer to data URI for Cloudinary
        const dataURI = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'profile-pictures',
            public_id: uuidv4(),
            overwrite: false
        });

        // Create user with Cloudinary URL
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new Registration({
            ...req.body,
            password: hashedPassword,
            profilePicture: result.secure_url,
            dateOfBirth: new Date(req.body.dateOfBirth)
        });

        await newUser.save();
        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        const status = error.code === 11000 ? 409 : 500;
        res.status(status).json({
            error: error.message,
            ...(error.http_code && { cloudinaryError: error })
        });
    }
});

// Admin Endpoint
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

// Delete Registration Endpoint
app.delete('/api/registration/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid registration ID' });
        }

        console.log(`Attempting to delete registration with ID: ${id}`);

        const deletedRegistration = await Registration.findByIdAndDelete(id);
        if (!deletedRegistration) {
            console.log(`Registration with ID: ${id} not found`);
            return res.status(404).json({ error: 'Registration not found' });
        }

        console.log(`Registration with ID: ${id} deleted successfully`);
        res.status(200).json({ message: 'Registration deleted successfully' });
    } catch (error) {
        console.error('Error deleting registration:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
