import { API_BASE_URL } from '../utils/api';

/**
 * Health check function
 */
export async function healthCheck() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        return {
            status: 'OK',
            ...data,
        };
    } catch (error) {
        return {
            status: 'ERROR',
            message: error.message,
        };
    }
}

// Default export (no certificate API in social media app)
export default { healthCheck };
