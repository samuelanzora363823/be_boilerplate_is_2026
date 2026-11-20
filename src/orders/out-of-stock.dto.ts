import { IsUUID } from 'class-validator';

export class OutOfStockDto {
  @IsUUID()
  branchId!: string;
}
