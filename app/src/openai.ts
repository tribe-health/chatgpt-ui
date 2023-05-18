import EventEmitter from "events";
import {Configuration, CreateEmbeddingRequest, OpenAIApi} from "openai";
import SSE from "./sse";
import { OpenAIMessage, Parameters } from "./types";

export const defaultSystemPrompt = `
You are Tribe Live GPT, a voice assistant in a meeting created by Tribe Health Solutions. 
You are an expert on the use of large language models and generative AI. Travis James is the CEO and CTO 
of Tribe Health Solutions. He has 30 years of experience building real time systems, natural language understanding, 
and natural language processing applications. Greg Spray on the board of Tribe Health and has a wealth of experience
building SaaS companies like MuleSoft and Ariba and selling them for billions of dollars. 
Keep your responses concise while still being friendly and personable. Return all results as markdown. 
If your response is a question, please append a question mark symbol to the end of it. Travis James is giving a presentation
on the impact of and possible uses for generative AI and ChatGPT in education and healthcare. Information about 
the presentation can be queried using ChatGPT at https://livegptmeet.tribecore.io and https://tribechatgpt.tribecore.io. 
He will talk about:

1. The brief history of ChatGPT, GPT-3, GPT-4, and other transformer large language models.
2. He will talk about the uses in these areas:
* Research
* Mental Health 
* Education (like during this presentation you can query chatgpt)
* Content creation and distribution.
3. Tribe Core, the technology that helps ChatGPT using vector word embeddings.
4. Risks of ChatGPT in the wrong hands.
Knowledge cutoff: 2021-09
Current date and time: {{ datetime }}
`.trim();

export const defaultModel = 'gpt-4';

export interface OpenAIResponseChunk {
    id?: string;
    done: boolean;
    choices?: {
        delta: {
            content: string;
        };
        index: number;
        finish_reason: string | null;
    }[];
    model?: string;
}

function parseResponseChunk(buffer: any): OpenAIResponseChunk {
    const chunk = buffer.toString().replace('data: ', '').trim();

    if (chunk === '[DONE]') {
        return {
            done: true,
        };
    }

    const parsed = JSON.parse(chunk);

    return {
        id: parsed.id,
        done: false,
        choices: parsed.choices,
        model: parsed.model,
    };
}

export async function createChatCompletion(messages: OpenAIMessage[], parameters: Parameters): Promise<string> {
    if (!parameters.apiKey) {
        throw new Error('No API key provided');
    }

    const configuration = new Configuration({
        apiKey: parameters.apiKey,
    });

    const openai = new OpenAIApi(configuration);

    /*const embeddingRequest = {
        'model':'text-embedding-ada-002',
        'input': defaultSystemPrompt
    }

    const embeddingResponse = await openai.createEmbedding(embeddingRequest);
    if (embeddingResponse.status !== 200) {
        messages.push({
            'role':'system',
            'content': embeddingResponse.data.
        })
    }*/

    const response = await openai.createChatCompletion({
        model: parameters.model,
        temperature: parameters.temperature,
        messages: messages as any,
    });

    return response.data.choices[0].message?.content?.trim() || '';
}

export async function createStreamingChatCompletion(messages: OpenAIMessage[], parameters: Parameters) {

    const emitter = new EventEmitter();

    let messagesToSend = [...messages].filter(m => m.role !== 'app');

    for (let i = messagesToSend.length - 1; i >= 0; i--) {
        const m = messagesToSend[i];
        if (m.role === 'user') {
            break;
        }
        if (m.role === 'assistant') {
            messagesToSend.splice(i, 1);
        }
    }

    messagesToSend.unshift({
        role: 'system',
        content: (parameters.initialSystemPrompt || defaultSystemPrompt).replace('{{ datetime }}', new Date().toLocaleString()),
    });

    messagesToSend = await selectMessagesToSendSafely(messagesToSend, 2048);

    const eventSource = new SSE('https://api.openai.com/v1/chat/completions', {
        method: "POST",
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Authorization': `Bearer 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`,
            'Content-Type': 'application/json',
        },
        payload: JSON.stringify({
            "model": parameters.model,
            "messages": messagesToSend,
            "temperature": parameters.temperature,
            "stream": true,
        }),
    }) as SSE;

    // TODO: enable (optional) server-side completion
    /*
    const eventSource = new SSE('/chatapi/completion/streaming', {
        method: "POST",
        headers: {
            'Accept': 'application/json, text/plain, *\/*',
            'Authorization': `Bearer ${(backend.current as any).token}`,
            'Content-Type': 'application/json',
        },
        payload: JSON.stringify({
            "model": "gpt-3.5-turbo",
            "messages": messagesToSend,
            "temperature": parameters.temperature,
            "stream": true,
        }),
    }) as SSE;
    */

    let contents = '';

    eventSource.addEventListener('error', (event: any) => {
        if (!contents) {
            let error = event.data;
            try {
                error = JSON.parse(error).error.message;
            } catch (e) {}
            emitter.emit('error', error);
        }
    });

    eventSource.addEventListener('message', async (event: any) => {

        if (event.data === '[DONE]') {
            emitter.emit('done');
            return;
        }

        try {
            const chunk = parseResponseChunk(event.data);
            if (chunk.choices && chunk.choices.length > 0) {
                contents += chunk.choices[0]?.delta?.content || '';
                emitter.emit('data', contents);
            }
        } catch (e) {
            console.error(e);
        }
    });

    eventSource.stream();

    return {
        emitter,
        cancel: () => eventSource.close(),
    };
}

async function selectMessagesToSendSafely(messages: OpenAIMessage[], maxTokens: number) {
    const { ChatHistoryTrimmer } = await import(/* webpackPreload: true */ './tokenizer/chat-history-trimmer');
    const compressor = new ChatHistoryTrimmer(messages, {
        maxTokens,
        preserveFirstUserMessage: true,
        preserveSystemPrompt: true,
    });
    return compressor.process();
}

setTimeout(() => selectMessagesToSendSafely([], 2048), 2000);
