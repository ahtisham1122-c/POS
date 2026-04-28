import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string = 'Internal server error';
    let error: string = 'INTERNAL_SERVER_ERROR';

    if (exception instanceof HttpException) {
      const res = exception.getResponse() as any;
      message = Array.isArray(res.message) ? res.message.join(', ') : (res.message || String(res));
      error = res.error || 'BAD_REQUEST';
      if (Array.isArray(res.message)) error = 'VALIDATION_ERROR';
    } else if (exception instanceof Error) {
      // In production never expose raw internal error messages to clients
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
        message = 'Internal server error';
      } else {
        message = exception.message;
      }
    }

    response.status(status).json({
      success: false,
      error,
      message,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }
}
