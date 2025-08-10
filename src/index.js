import dotenv from 'dotenv';
import connectDB from './db/index.js';
import { app } from './app.js';
dotenv.config({path: './env'})
connectDB()
.then(() => {
    app.listen(process.env.PORT || 8000,'0.0.0.0', () => {
        console.log(`Server is running on port :http://localhost:${process.env.PORT}`);
    });
})
.catch((error) => {
    console.error("Failed to connect to the database:", error);
})