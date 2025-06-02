import mongoose from "mongoose";

const connectDB = async () => {
     try{
        const conn= await mongoose.connect(
         `${process.env.MONGO_URI}`,{
            dbName:`${process.env.MONGO_DB}`
         })
        console.log(`MongoDB connected: ${conn.connection.host}`);
        console.log(`MongoDB connected: ${conn.connection.name}`);
     }
     catch (error) {
        console.error("MongoDB connection error:", error);
        process.exit(1); // Exit the process with failure
     }
}
export default connectDB;