
export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
}

export const successResponse = <T>(
  message: string,
  data: T,
): ApiSuccessResponse<T> => ({
  success: true,
  message,
  data,
});

export const errorResponse = (
  message: string,
): ApiErrorResponse => ({
  success: false,
  message,
});
