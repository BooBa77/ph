import { apiFetch } from '@/api/client'
import type { Vehicle, VehicleInput } from '@/types/trips'

/**
 * Каталог транспорта участника — «как снаряжение».
 *
 * Работает «от токена»: владельца в теле нет. На «Трансфере» этот список
 * показывается выбором, чтобы не заполнять тип транспорта в каждой карточке.
 */
export async function fetchVehicles(): Promise<Vehicle[]> {
  const response = await apiFetch<{ vehicles: Vehicle[] }>('/vehicles')

  return response.vehicles
}

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  return apiFetch<Vehicle>('/vehicles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateVehicle(
  id: string,
  patch: Partial<VehicleInput>,
): Promise<Vehicle> {
  return apiFetch<Vehicle>(`/vehicles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** DELETE — 409, пока транспорт едет в незакрытом походе. */
export async function removeVehicle(id: string): Promise<void> {
  return apiFetch<void>(`/vehicles/${id}`, { method: 'DELETE' })
}
