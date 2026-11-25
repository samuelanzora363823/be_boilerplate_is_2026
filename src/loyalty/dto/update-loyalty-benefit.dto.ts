import { CreateLoyaltyBenefitDto } from './create-loyalty-benefit.dto.js';

// H22: edición completa (PUT) de un beneficio; exige los mismos campos y
// validaciones que la creación. El estado se cambia con su propia ruta.
export class UpdateLoyaltyBenefitDto extends CreateLoyaltyBenefitDto {}
