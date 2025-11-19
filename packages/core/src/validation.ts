import type { z } from 'zod';

type AnySchema = z.ZodTypeAny;

interface SafeParseOptions {
  force?: boolean;
}

const computeShouldValidate = () => {
  const override = process.env.VALIDATION_MODE?.toLowerCase();
  if (override === 'always') return true;
  if (override === 'never') return false;
  return process.env.NODE_ENV !== 'production';
};

export const safeParse = <Schema extends AnySchema>(
  schema: Schema,
  value: unknown,
  options: SafeParseOptions = {}
): z.infer<Schema> => {
  const shouldValidate = options.force ?? computeShouldValidate();
  if (!shouldValidate) {
    return value as z.infer<Schema>;
  }
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw result.error;
};
