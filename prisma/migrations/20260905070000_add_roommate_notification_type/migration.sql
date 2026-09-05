-- AlterEnum: membership lifecycle notifications (isolated: PG cannot use a new
-- enum value inside the same transaction that creates it)
ALTER TYPE "NotificationType" ADD VALUE 'ROOMMATE';
