import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

import { PaymentMethod } from '../generated/prisma/client.js';

// H18: pagos realizados por meseros.
export class CreatePaymentDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amountReceived?: number;

  @IsOptional()
  @IsString()
  @Matches(/^(4242|0002)$/)
  cardLast4?: string;
}

// H19: pago en línea realizado por clientes.
export class CreateTakeawayPaymentDto {
  @IsString()
  @Matches(/^(4242|0002)$/)
  cardLast4!: string;
}