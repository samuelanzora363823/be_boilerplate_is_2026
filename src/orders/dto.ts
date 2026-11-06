import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
export class OpenAccountDto {
  @IsUUID() tableId!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
}
export class OrderItemDto {
  @IsUUID() dishId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() @MaxLength(100) notes?: string;
}
export class CreateTableOrderDto {
  @IsUUID() accountId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class CreateTakeawayOrderDto {
  @IsUUID() branchId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

// H6: modificación de cantidades de los ítems existentes del pedido.
export class UpdateOrderQuantityDto {
  @IsUUID() itemId!: string;
  @IsInt() @Min(1) quantity!: number;
}
export class UpdateTableOrderDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => UpdateOrderQuantityDto)
  items!: UpdateOrderQuantityDto[];
}
