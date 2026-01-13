export const getOtpEmailTemplate = (otp) => {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Account</title>
        <style>
            body {
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                background-color: #f6f9fc;
                margin: 0;
                padding: 0;
                -webkit-font-smoothing: antialiased;
            }
            .container {
                max-width: 600px;
                margin: 40px auto;
                background: #ffffff;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                overflow: hidden;
            }
            .header {
                background-color: #4F46E5; /* Brand Color */
                padding: 30px;
                text-align: center;
            }
            .header h1 {
                color: #ffffff;
                margin: 0;
                font-size: 24px;
                font-weight: 600;
                letter-spacing: 1px;
            }
            .content {
                padding: 40px 30px;
                text-align: center;
            }
            .content h2 {
                color: #1a1a1a;
                margin-top: 0;
                font-size: 20px;
                font-weight: 600;
            }
            .content p {
                color: #525f7f;
                font-size: 16px;
                line-height: 24px;
                margin-bottom: 24px;
            }
            .otp-box {
                background-color: #F3F4F6;
                border: 2px dashed #4F46E5;
                border-radius: 8px;
                padding: 16px;
                margin: 24px auto;
                display: inline-block;
            }
            .otp-code {
                font-family: 'Courier New', Courier, monospace;
                font-size: 32px;
                font-weight: 700;
                color: #4F46E5;
                letter-spacing: 4px;
                margin: 0;
            }
            .footer {
                background-color: #f9fafb;
                padding: 20px;
                text-align: center;
                border-top: 1px solid #e5e7eb;
            }
            .footer p {
                color: #9ca3af;
                font-size: 12px;
                margin: 0;
            }
            .warning {
                font-size: 13px;
                color: #ef4444; /* Red color for warning */
                margin-top: 16px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>SpendTrail</h1>
            </div>
            <div class="content">
                <h2>Verify Your Email</h2>
                <p>Thanks for creating an account! Please use the verification code below to confirm your email address.</p>
                
                <div class="otp-box">
                    <p class="otp-code">${otp}</p>
                </div>

                <p class="warning">This code will expire in 10 minutes.</p>
                
                <p>If you have any questions, just reply to this email—we're here to help.</p>
                <p style="font-size: 14px; color: #8898aa;">If you didn't request this code, you can safely ignore this email.</p>
            </div>
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} SpendTrail. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
};
