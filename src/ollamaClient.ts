import * as http from 'http';
import * as https from 'https';

export interface OllamaConfig {
    baseURL: string;
    model: string;
}

export interface OllamaResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    context?: number[]; // Context for follow-up requests
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

// Placeholder for a more specific stream response part if needed later
export interface OllamaStreamResponsePart extends OllamaResponse {
    // Stream-specific fields, if any, can be added.
    // For now, it's the same as OllamaResponse for simplicity as 'response' field accumulates.
}

/**
 * Sends a prompt to the Ollama API and returns the streamed response.
 *
 * @param config The Ollama configuration (baseURL and model).
 * @param prompt The prompt to send to the model.
 * @param context Optional context from a previous response for conversational continuity.
 * @param onStream Callback function to handle each part of the streamed response.
 * @param onError Callback function to handle errors.
 * @param onDone Callback function when the stream is complete.
 */
export function streamOllamaResponse(
    config: OllamaConfig,
    prompt: string,
    context: number[] | undefined,
    onStream: (chunk: OllamaStreamResponsePart) => void,
    onError: (error: Error) => void,
    onDone: () => void
): void {
    let ollamaURL: URL;
    try {
        ollamaURL = new URL(config.baseURL);
    } catch (e: any) {
        onError(new Error(`Invalid base URL format for ${config.model}: ${config.baseURL}. Error: ${e.message}`));
        return;
    }
    const client = ollamaURL!.protocol === 'https:' ? https : http;
    const endpoint = '/api/generate'; // Standard Ollama endpoint

    const postData = JSON.stringify({
        model: config.model,
        prompt: prompt,
        context: context,
        stream: true, // We want to stream the response
    });

    const options = {
        hostname: ollamaURL.hostname,
        port: ollamaURL.port || (ollamaURL.protocol === 'https:' ? 443 : 80),
        path: endpoint,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
        },
    };

    const req = client.request(options, (res) => {
        let accumulatedJson = "";
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            accumulatedJson += chunk.toString();
            // Try to parse each line as a separate JSON object, as Ollama streams line-delimited JSON
            let boundary = accumulatedJson.indexOf('\n');
            while (boundary !== -1) {
                const jsonLine = accumulatedJson.substring(0, boundary);
                accumulatedJson = accumulatedJson.substring(boundary + 1);
                if (jsonLine.trim()) {
                    try {
                        const parsed = JSON.parse(jsonLine) as OllamaStreamResponsePart;
                        onStream(parsed);
                    } catch (e) {
                        // Not a complete JSON object yet, or malformed.
                        // If it's an error in parsing a presumed complete line, report it.
                        // Otherwise, wait for more data.
                        // For simplicity, we'll assume here that errors in JSON parsing mean an incomplete line,
                        // and it will eventually form a complete JSON. More robust error handling might be needed.
                        console.warn("Error parsing JSON stream part:", e, "Line:", jsonLine);
                    }
                }
                boundary = accumulatedJson.indexOf('\n');
            }
        });
        res.on('end', () => {
            // Process any remaining part of the buffer
            if (accumulatedJson.trim()) {
                try {
                    const parsed = JSON.parse(accumulatedJson) as OllamaStreamResponsePart;
                    onStream(parsed);
                } catch (e: any) {
                     onError(new Error(`Failed to parse final JSON stream part for ${config.model}: ${e.message}. Data: ${accumulatedJson}`));
                     return;
                }
            }
            onDone();
        });
    });

    req.on('error', (e: any) => {
        onError(new Error(`Network or request error for ${config.model} at ${config.baseURL}: ${e.message}`));
    });

    req.write(postData);
    req.end();
}

/**
 * Sends a prompt to the Ollama API and returns the full response once completed.
 * This is a non-streaming version.
 *
 * @param config The Ollama configuration (baseURL and model).
 * @param prompt The prompt to send to the model.
 * @param context Optional context from a previous response for conversational continuity.
 * @returns A promise that resolves to the full OllamaResponse.
 */
export async function getOllamaResponse(
    config: OllamaConfig,
    prompt: string,
    context?: number[]
): Promise<OllamaResponse> {
    return new Promise((resolve, reject) => {
        let ollamaURL: URL;
        try {
            ollamaURL = new URL(config.baseURL);
        } catch (e: any) {
            reject(new Error(`Invalid base URL format for ${config.model}: ${config.baseURL}. Error: ${e.message}`));
            return;
        }
        const client = ollamaURL!.protocol === 'https:' ? https : http;
        const endpoint = '/api/generate';

        const postData = JSON.stringify({
            model: config.model,
            prompt: prompt,
            context: context,
            stream: false, // We want the full response here
        });

        const options = {
            hostname: ollamaURL.hostname,
            port: ollamaURL.port || (ollamaURL.protocol === 'https:' ? 443 : 80),
            path: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = client.request(options, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        const parsedResponse = JSON.parse(data) as OllamaResponse;
                        resolve(parsedResponse);
                    } else {
                        reject(new Error(`${config.model} API request failed with status ${res.statusCode} at ${config.baseURL}: ${data}`));
                    }
                } catch (e: any) {
                    reject(new Error(`Failed to parse ${config.model} response: ${e.message}. Response data: ${data}`));
                }
            });
        });

        req.on('error', (e: any) => {
            reject(new Error(`Network or request error for ${config.model} at ${config.baseURL}: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
}
