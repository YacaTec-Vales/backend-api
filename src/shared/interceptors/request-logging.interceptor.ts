import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response, startedAt),
        error: () => this.log(request, response, startedAt),
      }),
    );
  }

  private log(
    request: Request,
    response: Response,
    startedAt: bigint,
  ): void {
    const elapsedMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.log(
      `${request.method} ${request.originalUrl} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`,
    );
  }
}
