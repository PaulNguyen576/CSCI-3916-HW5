const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt'); // Use bcrypt, not bcrypt-nodejs

// No need for mongoose.Promise = global.Promise;

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DB); // useNewUrlParser and useUnifiedTopology are no longer needed
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error); // Log the actual error object
    process.exit(1); // Exit the process if the connection fails (optional, but good practice)
  }
};

connectDB();


const UserSchema = new Schema({
    name: String,
    username: { type: String, required: true, index: { unique: true } },
    password: { type: String, required: true, select: false }
});

UserSchema.pre('save', async function(next) {  // Use async/await for cleaner code
    const user = this;

    if (!user.isModified('password')) return next();

    try {
        const hash = await bcrypt.hash(user.password, 10); // 10 is the salt rounds (adjust as needed)
        user.password = hash;
        next();
    } catch (err) {
        return next(err);
    }
});

UserSchema.methods.comparePassword = async function(password) { // Use async/await
    try {
        return await bcrypt.compare(password, this.password);
    } catch (err) {
        return false; // Or handle the error as you see fit
    }
};

module.exports = mongoose.model('User', UserSchema);