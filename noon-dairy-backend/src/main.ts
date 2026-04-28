import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import helmet from 'helmet';

const logger = new Logger('Bootstrap');

function requireStrongSecret(name: string, minLength = 24) {
  const value = process.env[name];
  const looksLikePlaceholder = !value || /change-this|default|secret$/i.test(value);
  if (looksLikePlaceholder || value.length < minLength) {
    throw new Error(`${name} must be set to a strong random value of at least ${minLength} characters`);
  }
}

async function bootstrap() {
  requireStrongSecret('JWT_SECRET');
  requireStrongSecret('JWT_REFRESH_SECRET');
  requireStrongSecret('SYNC_DEVICE_SECRET');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const isProd = process.env.NODE_ENV === 'production';

  // Security headers
  app.use(helmet());

  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger — only in non-production
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Noon Dairy API')
      .setDescription('Noon Dairy POS Backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger available at /api/docs');
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`Server running on port ${port} [${isProd ? 'production' : 'development'}]`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err.message);
  process.exit(1);
});
