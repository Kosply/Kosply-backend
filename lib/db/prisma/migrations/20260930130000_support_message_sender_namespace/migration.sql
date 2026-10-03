-- A dashboard operator is an `admins` row, not a `users` row, so a NOT NULL
-- `users` FK on support_messages.sender_id made every dashboard reply fail with
-- P2003. Make it nullable and attribute the sender by role + name snapshot.
ALTER TABLE "support_messages" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "support_messages" ADD COLUMN "senderRole" TEXT NOT NULL DEFAULT 'BUYER';
ALTER TABLE "support_messages" ADD COLUMN "senderName" TEXT;
