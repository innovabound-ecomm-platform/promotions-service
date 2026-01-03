import { Response } from "express";

interface PaginationOptions {
  page: number;
  limit: number;
  total: number;
}

interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

interface SuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    errors?: Record<string, string[]>;
  };
}

export function success<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  message?: string
): Response {
  const response: SuccessResponse<T> = {
    success: true,
    data,
    ...(message && { message }),
  };
  return res.status(statusCode).json(response);
}

export function paginate<T>(
  res: Response,
  data: T[],
  options: PaginationOptions
): Response {
  const { page, limit, total } = options;
  const totalPages = Math.ceil(total / limit);

  const response: PaginatedResponse<T> = {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };

  return res.status(200).json(response);
}

export function errorResponse(
  res: Response,
  code: string,
  message: string,
  statusCode: number = 400,
  errors?: Record<string, string[]>
): Response {
  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(errors && { errors }),
    },
  };

  return res.status(statusCode).json(response);
}
