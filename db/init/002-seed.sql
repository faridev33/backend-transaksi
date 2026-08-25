INSERT INTO users (id, name, email, password_hash, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Andi Pengirim', 'andi@example.com', crypt('rahasia123', gen_salt('bf')), 'USER'),
  ('22222222-2222-2222-2222-222222222222', 'Budi Penerima', 'budi@example.com', crypt('rahasia123', gen_salt('bf')), 'USER'),
  ('99999999-9999-9999-9999-999999999999', 'Admin Sistem', 'admin@example.com', crypt('admin123', gen_salt('bf')), 'ADMIN');

INSERT INTO accounts (id, user_id, account_number, currency, balance) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '1000000001', 'IDR', 100000.00),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '1000000002', 'IDR', 50000.00),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '99999999-9999-9999-9999-999999999999', '1000000003', 'IDR', 0.00);
