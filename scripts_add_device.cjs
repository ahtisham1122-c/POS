const fs = require('fs');

const schemaPath = 'noon-dairy-backend/prisma/schema.prisma';
let schema = fs.readFileSync(schemaPath, 'utf-8');

if (!schema.includes('model Device')) {
  schema += `\nmodel Device {
  id            String    @id @default(cuid())
  deviceId      String    @unique
  deviceName    String
  terminalNumber Int
  lastSeenAt    DateTime?
  lastSyncedAt  DateTime?
  createdAt     DateTime  @default(now())
}\n`;
  fs.writeFileSync(schemaPath, schema);
}
