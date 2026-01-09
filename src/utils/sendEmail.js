import nodemailer from 'nodemailer';

const sendEmail = async (email, subject, text) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.error("FATAL ERROR: EMAIL_USER or EMAIL_PASS environment variables are not set.");
            throw new Error("Missing email configuration");
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail', // or your preferred service
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: subject,
            text: text,
        });

        console.log(`Email sent successfully to ${email}`);
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Email verification failed');
    }
};

export default sendEmail;
