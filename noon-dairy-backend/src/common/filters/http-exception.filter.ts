import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    
    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let error = 'INTERNAL_SERVER_ERROR';

    if (exception instanceof HttpException) {
      const res = exception.getResponse() as any;
      message = res.message || res;
      error = res.error || 'BAD_REQUEST';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Convert NestJS validation arrays to string
    if (Array.isArray(message)) {
      message = message.join(', ');
      error = 'VALIDATION_ERROR';
    }

    response.status(status).json({
      success: false,
      error: error,
      message: message,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }
}
