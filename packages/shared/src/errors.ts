/** Stable, machine-readable error codes shared by API, workers and frontend. */
export const ERROR_CODES = {
  UNSUPPORTED_FILE: { status: 415, message: 'This file type is not supported by the selected tool.' },
  FILE_TOO_LARGE: { status: 413, message: 'The file is larger than the allowed limit.' },
  EMPTY_UPLOAD: { status: 400, message: 'No file was uploaded, or the file is empty.' },
  TOO_MANY_FILES: { status: 400, message: 'Too many files were uploaded for this tool.' },
  TOO_FEW_FILES: { status: 400, message: 'This tool needs more files than were uploaded.' },
  INVALID_OPTIONS: { status: 400, message: 'The tool options are invalid.' },
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid.' },
  CORRUPT_PDF: { status: 422, message: 'The PDF appears to be corrupt, encrypted or unreadable.' },
  CONVERSION_FAILED: { status: 500, message: 'The file could not be processed.' },
  WORKER_FAILURE: { status: 500, message: 'The processing worker failed. Please try again.' },
  JOB_NOT_FOUND: { status: 404, message: 'Job not found.' },
  FILE_NOT_FOUND: { status: 404, message: 'File not found.' },
  FILE_EXPIRED: { status: 410, message: 'This file has expired and was deleted.' },
  UNAUTHORIZED: { status: 401, message: 'You need to sign in to do that.' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to do that.' },
  ACCOUNT_DISABLED: { status: 403, message: 'This account has been disabled.' },
  EMAIL_TAKEN: { status: 409, message: 'An account with this email already exists.' },
  INVALID_CREDENTIALS: { status: 401, message: 'Incorrect email or password.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please slow down and try again shortly.' },
  STORAGE_FAILURE: { status: 500, message: 'Storage error. Please try again.' },
  JOB_NOT_CANCELLABLE: { status: 409, message: 'This job can no longer be cancelled.' },
  INTERNAL: { status: 500, message: 'Something went wrong on our side.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.details = details;
  }
}
