/**
 * @file src/ollamaClient.ts
 * This module provides functions to interact with the Ollama API.
 * It supports both streaming and non-streaming responses for generating content
 * from Ollama language models, and includes error handling for API communication.
 */

import * as http from 'http';
import * as https from 'https';

/**
 * Configuration for making a request to an Ollama model.
 */
export interface OllamaConfig {
    baseURL: string; // Base URL of the Ollama API (e.g., "http://localhost:11434")
    model: string;   // Name of the model to use (e.g., "llama2", "mistral")
}

/**
 * Represents a complete (non-streamed) response from the Ollama API's /api/generate endpoint.
 * Also used as the structure for individual parts of a streamed response where 'response'
 * contains the chunk of text and 'done' indicates the final part.
 */
export interface OllamaResponse {
    model: string;            // The model name that generated the response.
    created_at: string;       // Timestamp of when the response was created.
    response: string;         // The textual response from the model.
    done: boolean;            // True if this is the final response part (for streaming) or the request is complete.
    context?: number[];       // Optional context array for conversational continuity.
    total_duration?: number;  // Total time spent on the request.
    load_duration?: number;   // Time spent loading the model.
    prompt_eval_count?: number; // Number of tokens in the prompt evaluation.
    prompt_eval_duration?: number; // Time spent evaluating the prompt.
    eval_count?: number;      // Number of tokens in the response generation.
    eval_duration?: number;   // Time spent generating the response.
}

/**
 * Represents a part of a streamed response from Ollama.
 * For text generation, this typically includes a chunk of the 'response' string.
 * The 'done' field indicates if this is the final part of the stream.
 */
export interface OllamaStreamResponsePart extends OllamaResponse {
    // Currently, no additional fields beyond what OllamaResponse provides for stream parts.
    // This interface is kept for potential future differentiation.
}

/**
 * Sends a prompt to the Ollama API and processes the response as a stream.
 * Each chunk of the response is passed to the onStream callback.
 * Errors are passed to the onError callback.
 * The onDone callback is called when the stream completes successfully.
 *
 * @param config The Ollama configuration (baseURL and model name).
 * @param prompt The prompt string to send to the model.
 * @param context Optional conversation context (array of numbers) from a previous response.
 * @param onStream Callback function invoked for each data chunk received from the stream.
 *                 It receives an OllamaStreamResponsePart object.
 * @param onError Callback function invoked if a network error occurs or the API returns an error.
 * @param onDone Callback function invoked when the stream has successfully completed (all parts received).
 *
 * @example
 * // Conceptual usage:
 * // streamOllamaResponse(
 * //   { baseURL: "http://localhost:11434", model: "llama2" },
 * //   "Why is the sky blue?",
 * //   undefined, // No prior context
 * //   (chunk) => { console.log("Stream chunk:", chunk.response); if(chunk.done) { console.log("Context:", chunk.context); } },
 * //   (error) => { console.error("Stream error:", error); },
 * //   () => { console.log("Stream finished."); }
 * // );
 */
export function streamOllamaResponse(
    config: OllamaConfig,
    prompt: string,
    context: number[] | undefined,
    onStream: (chunk: OllamaStreamResponsePart) => void,
    onError: (error: Error) => void,
    onDone: () => void
): void {
    // Variable to store the parsed URL object
    let ollamaURL: URL;
    try {
        ollamaURL = new URL(config.baseURL);
    } catch (e: any) {
        onError(new Error(`Invalid base URL format for ${config.model}: ${config.baseURL}. Error: ${e.message}`));
        return;
    }
    // Select http or https client based on the parsed URL protocol
    const client = ollamaURL!.protocol === 'https:' ? https : http;
    // Standard Ollama API endpoint for text generation
    const endpoint = '/api/generate';

    const postData = JSON.stringify({
        model: config.model,
        prompt: prompt,
        context: context,
        stream: true, // Explicitly request a streaming response from Ollama
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
        // Ollama streams multiple JSON objects, each on a new line.
        // Accumulate data and process each line-delimited JSON object.
        res.on('data', (chunk) => {
            accumulatedJson += chunk.toString();
            let boundary = accumulatedJson.indexOf('\n');
            while (boundary !== -1) {
                const jsonLine = accumulatedJson.substring(0, boundary);
                accumulatedJson = accumulatedJson.substring(boundary + 1);
                if (jsonLine.trim()) {
                    try {
                        const parsed = JSON.parse(jsonLine) as OllamaStreamResponsePart;
                        onStream(parsed);
                    } catch (e) {
                        // This can happen if a chunk doesn't form a complete JSON object yet,
                        // or if there's truly malformed JSON.
                        // For partial JSON, it will be caught and processed with more data.
                        // For malformed JSON on a complete line, it's logged.
                        console.warn("Error parsing JSON stream part:", e, "Line:", jsonLine);
                    }
                }
                boundary = accumulatedJson.indexOf('\n');
            }
        });
        res.on('end', () => {
            // Process any remaining part of the buffer after the stream ends.
            if (accumulatedJson.trim()) {
                try {
                    const parsed = JSON.parse(accumulatedJson) as OllamaStreamResponsePart;
                    onStream(parsed);
                } catch (e: any) {
                     onError(new Error(`Failed to parse final JSON stream part for ${config.model}: ${e.message}. Data: ${accumulatedJson}`));
                     return;
                }
            }
            onDone(); // Signal completion of the stream.
        });
    });

    req.on('error', (e: any) => {
        onError(new Error(`Network or request error for ${config.model} at ${config.baseURL}: ${e.message}`));
    });

    req.write(postData);
    req.end();
}

/**
 * Sends a prompt to the Ollama API and returns the full, non-streamed response.
 * This is suitable for when the entire response is needed before further processing.
 *
 * @param config The Ollama configuration (baseURL and model name).
 * @param prompt The prompt string to send to the model.
 * @param context Optional conversation context (array of numbers) from a previous response.
 * @returns A Promise that resolves to the full OllamaResponse object.
 * @throws An error if the API request fails, if the response cannot be parsed,
 *         or if the base URL is invalid.
 *
 * @example
 * // Conceptual usage:
 * // async function fetchFullResponse() {
 * //   try {
 * //     const response = await getOllamaResponse(
 * //       { baseURL: "http://localhost:11434", model: "llama2" },
 * //       "What is the capital of France?",
 * //       undefined
 * //     );
 * //     console.log("Full response:", response.response);
 * //     console.log("Context for next turn:", response.context);
 * //   } catch (error) {
 * //     console.error("Failed to get full response:", error);
 * //   }
 * // }
 */
export async function getOllamaResponse(
    config: OllamaConfig,
    prompt: string,
    context?: number[]
): Promise<OllamaResponse> {
    return new Promise((resolve, reject) => {
        // Variable to store the parsed URL object
        let ollamaURL: URL;
        try {
            ollamaURL = new URL(config.baseURL);
        } catch (e: any) {
            reject(new Error(`Invalid base URL format for ${config.model}: ${config.baseURL}. Error: ${e.message}`));
            return;
        }
        // Select http or https client based on the parsed URL protocol
        const client = ollamaURL!.protocol === 'https:' ? https : http;
        // Standard Ollama API endpoint for text generation
        const endpoint = '/api/generate';

        const postData = JSON.stringify({
            model: config.model,
            prompt: prompt,
            context: context,
            stream: false, // Explicitly request a non-streaming (full) response from Ollama
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
                    // Ensure the request was successful before attempting to parse.
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        const parsedResponse = JSON.parse(data) as OllamaResponse;
                        resolve(parsedResponse);
                    } else {
                        // API returned an error status code.
                        reject(new Error(`${config.model} API request failed with status ${res.statusCode} at ${config.baseURL}: ${data}`));
                    }
                } catch (e: any) {
                    // Error parsing the JSON response from the API.
                    reject(new Error(`Failed to parse ${config.model} response: ${e.message}. Response data: ${data}`));
                }
            });
        });

        req.on('error', (e: any) => {
            // Network or other request-level error.
            reject(new Error(`Network or request error for ${config.model} at ${config.baseURL}: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
}
