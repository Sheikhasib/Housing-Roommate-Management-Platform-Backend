import { RoomStatus } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";

// Recompute the occupancy-derived status of a room after a bed is freed/used.
// AVAILABLE when empty, RESERVED when partially occupied and OCCUPIED when full.
export const recalculateRoomStatus = async (roomId: string, tx?: any) => {
	const db = tx ?? prisma;
	const room = await db.room.findUnique({ where: { id: roomId } });
	if (!room) return;

	// a room in maintenance keeps its status regardless of occupancy
	if (room.status === RoomStatus.MAINTENANCE) return;

	if (room.occupiedBeds <= 0) {
		await db.room.update({
			where: { id: roomId },
			data: { status: RoomStatus.AVAILABLE },
		});
	} else if (room.occupiedBeds >= room.bedCount) {
		await db.room.update({
			where: { id: roomId },
			data: { status: RoomStatus.OCCUPIED },
		});
	} else {
		await db.room.update({
			where: { id: roomId },
			data: { status: RoomStatus.RESERVED },
		});
	}
};
