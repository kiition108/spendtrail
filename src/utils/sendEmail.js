import logger from './logger.js';
import { Resend } from 'resend';

const sendEmail = async (email, subject, text, html) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            logger.error("FATAL ERROR: RESEND_API_KEY is not set.");
            throw new Error("Missing email configuration");
        }

        const resend = new Resend(process.env.RESEND_API_KEY);

        const { data, error } = await resend.emails.send({
            from: 'SpendTrail Support <support@spendtrail.app>', // Better trust than noreply
            to: email,
            subject: subject,
            text: text, // Plain text fallback
            html: html || `<p>${text}</p>` // Use provided HTML or wrap text
        });

        if (error) {
            logger.error('Resend API Error:', { error });
            throw error;
        }

        logger.info(`Email sent successfully via Resend`, { email, id: data.id });
    } catch (error) {
        logger.error('Error sending email:', { error: error.message });
        throw new Error('Email verification failed');
    }
};

export default sendEmail;
