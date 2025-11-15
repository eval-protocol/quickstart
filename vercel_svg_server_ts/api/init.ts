/**
 * Vercel serverless function for SVGBench remote evaluation
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { initRequestSchema, InitRequest } from '../src/models/types.js';
import { Status } from '../src/models/status.js';
import { mapOpenAIErrorToStatus } from '../src/models/exceptions.js';
import { resolveApiKey } from '../src/config/environment.js';
import { createRolloutLogger } from '../src/config/logger.js';
import { withFireworksLogging } from '../src/config/fireworks-vercel.js';


async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Handle health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'SVGBench Vercel TypeScript Serverless Function',
      endpoints: {
        'POST /init': 'Process SVGBench evaluation requests',
        'GET /': 'Health check endpoint'
      }
    });
  }

  // Only handle POST requests for the main functionality
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: `Method ${req.method} not allowed`
    });
  }

  let rolloutId: string | undefined;
  let apiKey: string | null = null;
  let logger: any = null;

  try {
    // Parse and validate request body
    const parseResult = initRequestSchema.safeParse(req.body);

    if (!parseResult.success) {
      const errorMsg = `Invalid request format: ${parseResult.error.message}`;
      console.error(`ERROR:rollout:unknown:${errorMsg}`);

      return res.status(400).json({
        error: errorMsg,
        details: parseResult.error.issues
      });
    }

    const initRequest: InitRequest = parseResult.data;
    rolloutId = initRequest.metadata.rollout_id;

    // Initialize rollout-specific logger for this rollout
    logger = createRolloutLogger(rolloutId);
    logger.info('Received rollout request');

    // Validate required fields
    if (!initRequest.messages || initRequest.messages.length === 0) {
      const errorMsg = 'messages is required and cannot be empty';
      logger.error(errorMsg);

      return res.status(400).json({
        error: errorMsg,
        rollout_id: rolloutId
      });
    }

    // Resolve API key with fallback chain
    apiKey = resolveApiKey(initRequest.api_key);
    if (!apiKey) {
      const errorMsg = 'API key not provided in request or FIREWORKS_API_KEY environment variable';
      logger.error(errorMsg);

      return res.status(401).json({
        error: errorMsg,
        rollout_id: rolloutId
      });
    }

    const startTime = Date.now();

    // Create OpenAI client
    const openaiClient = new OpenAI({
      apiKey,
      baseURL: initRequest.model_base_url!,  // Always provided in your use case
    });

    const model = initRequest.completion_params?.model;
    logger.info(`Sending completion request to model ${model}`);

    // Prepare completion arguments - sanitize messages
    const allowedMessageFields = new Set([
      'role', 'content', 'name', 'tool_call_id', 'tool_calls', 'function_call'
    ]);

    const sanitizedMessages = (initRequest.messages || []).map(message => {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(message)) {
        if (allowedMessageFields.has(key) && value !== undefined && value !== null) {
          sanitized[key] = value;
        }
      }
      if (!sanitized.role) {
        throw new Error('Message role is required');
      }
      return sanitized as OpenAI.Chat.ChatCompletionMessageParam;
    });

    // Build completion parameters
    const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
      model: String(model),
      messages: sanitizedMessages,
      stream: false
    };

    // Add optional parameters
    if (initRequest.completion_params?.temperature !== undefined) {
      completionParams.temperature = Number(initRequest.completion_params.temperature);
    }
    if (initRequest.completion_params?.max_tokens !== undefined) {
      completionParams.max_tokens = Number(initRequest.completion_params.max_tokens);
    }
    if (initRequest.completion_params?.top_p !== undefined) {
      completionParams.top_p = Number(initRequest.completion_params.top_p);
    }
    if (initRequest.completion_params?.frequency_penalty !== undefined) {
      completionParams.frequency_penalty = Number(initRequest.completion_params.frequency_penalty);
    }
    if (initRequest.completion_params?.presence_penalty !== undefined) {
      completionParams.presence_penalty = Number(initRequest.completion_params.presence_penalty);
    }
    if (initRequest.completion_params?.stop !== undefined) {
      completionParams.stop = initRequest.completion_params.stop;
    }

    // Add tools if present
    if (initRequest.tools && initRequest.tools.length > 0) {
      completionParams.tools = initRequest.tools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.function.name,
          ...(tool.function.description && { description: tool.function.description }),
          ...(tool.function.parameters && { parameters: tool.function.parameters })
        }
      }));
    }

    // Debug log showing what we're sending (similar to Python version)
    const maskedApiKey = apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'undefined';

    logger.info(`DEBUG: ${initRequest.model_base_url}, COMPLETION_KWARGS: ${JSON.stringify(completionParams)}, API_KEY: ${maskedApiKey}, MODEL: ${model}, BASE_URL: ${initRequest.model_base_url}`);

    // Perform chat completion synchronously
    const completion = await openaiClient.chat.completions.create(completionParams);
    
    const status = Status.rolloutFinished();
    logger.info(`Rollout ${rolloutId} completed`, { status });

    // Return successful response with completion
    return res.status(200).json({
      status: 'completed',
      rollout_id: rolloutId,
      message: 'Rollout completed successfully'
    });

  } catch (error: any) {
    // Handle all errors in one place
    const status = mapOpenAIErrorToStatus(error);
    
    logger.error(`Rollout ${rolloutId} failed: ${error.message}`, { status });

    // Return appropriate HTTP status based on error type
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
      return res.status(403).json({
        error: `Authentication failed: ${error.message}`,
        rollout_id: rolloutId
      });
    } else if (error instanceof OpenAI.NotFoundError) {
      return res.status(404).json({
        error: `Model not found: ${error.message}`,
        rollout_id: rolloutId
      });
    } else if (error instanceof OpenAI.RateLimitError) {
      return res.status(429).json({
        error: `Rate limit exceeded: ${error.message}`,
        rollout_id: rolloutId
      });
    } else if (error instanceof OpenAI.BadRequestError) {
      return res.status(400).json({
        error: `Bad request: ${error.message}`,
        rollout_id: rolloutId
      });
    } else if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return res.status(408).json({
        error: `Request timeout: ${error.message}`,
        rollout_id: rolloutId
      });
    } else if (error instanceof OpenAI.InternalServerError) {
      return res.status(502).json({
        error: `Upstream server error: ${error.message}`,
        rollout_id: rolloutId
      });
    } else if (error instanceof OpenAI.UnprocessableEntityError) {
      return res.status(422).json({
        error: `Invalid request data: ${error.message}`,
        rollout_id: rolloutId
      });
    } else {
      // Network errors, parsing errors, and unexpected errors
      return res.status(500).json({
        error: `Internal error: ${error.message}`,
        rollout_id: rolloutId
      });
    }
  }
}

export default withFireworksLogging(handler);
