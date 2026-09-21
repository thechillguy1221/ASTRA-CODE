-- Room membership is intentionally separate from organization seat membership.
-- Organization membership grants a seat; room_members grants access to one Room.
CREATE TABLE IF NOT EXISTS room_members (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'AGENT_USER', 'VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  joined_at timestamptz,
  suspended_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS room_members_user_idx ON room_members(user_id, status);
CREATE INDEX IF NOT EXISTS room_members_room_idx ON room_members(room_id, status);

-- Preserve existing owners and already-redeemed invitations without granting
-- every organization member access to every existing Room.
INSERT INTO room_members(
  id, room_id, organization_id, user_id, role, status, permissions, joined_at
)
SELECT md5(r.id::text || ':owner')::uuid, r.id, r.organization_id, r.owner_user_id, 'OWNER', 'ACTIVE',
       '[]'::jsonb, r.created_at
  FROM rooms r
 WHERE NOT EXISTS (
   SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = r.owner_user_id
 );

INSERT INTO room_members(
  id, room_id, organization_id, user_id, role, status, permissions, joined_at
)
SELECT md5(i.id::text || ':redeemed')::uuid, i.room_id, r.organization_id, i.redeemed_by, 'AGENT_USER', 'ACTIVE',
       '[]'::jsonb, COALESCE(i.redeemed_at, i.created_at)
  FROM room_invitations i
  JOIN rooms r ON r.id = i.room_id
 WHERE i.redeemed_by IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM room_members rm
      WHERE rm.room_id = i.room_id AND rm.user_id = i.redeemed_by
   );
