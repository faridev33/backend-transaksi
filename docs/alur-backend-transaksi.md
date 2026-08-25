# Alur backend transaksi: dari frontend sampai database

Dokumen ini menjelaskan ke mana data berjalan, apa yang dilakukan setiap file, dan ke mana proses berpindah saat terjadi kesalahan.

## Cara memakai diagram di Notion

Salin isi salah satu blok `mermaid` di bawah ke blok kode di Notion. Bila workspace Notion Anda belum menampilkan diagram Mermaid sebagai visual, simpan blok ini sebagai dokumentasi sumber; Anda dapat merendernya di Mermaid Live Editor lalu memasukkan hasil PNG/SVG ke halaman Notion.

## Diagram utama: transfer dari frontend

```mermaid
flowchart TD
    A[Frontend: user klik Kirim Uang] --> B[HTTP POST /api/transactions]
    B --> C[app.js]
    C --> D[transaction.routes.js]
    D --> E{auth.middleware.js\nBearer token valid?}
    E -- Tidak --> F[error.middleware.js\n401 UNAUTHENTICATED]
    F --> G[Frontend menerima JSON error]
    E -- Ya --> H[transaction.controller.js]
    H --> I{Format body valid?\nZod: ID akun, amount, currency}
    I -- Tidak --> J[error.middleware.js\n400 VALIDATION_ERROR]
    J --> G
    I -- Ya --> K[transaction.service.js]
    K --> L[pool.js\nBEGIN transaksi database]
    L --> M[PostgreSQL: buat transaksi PROCESSING]
    M --> N[PostgreSQL: kunci 2 akun\nSELECT ... FOR UPDATE]
    N --> O{Pemilik akun, akun aktif,\nmata uang, dan saldo valid?}
    O -- Tidak --> P[transactions: status FAILED\nalasan gagal]
    P --> Q[COMMIT catatan gagal\ntanpa ubah saldo]
    Q --> R[error.middleware.js\n403 atau 422]
    R --> G
    O -- Ya --> S[Kurangi saldo pengirim]
    S --> T[Tambah saldo penerima]
    T --> U[ledger_entries:\nDEBIT dan CREDIT]
    U --> V[transactions: status SUCCESS]
    V --> W[COMMIT]
    W --> X[transaction.controller.js\n201 JSON transaksi]
    X --> Y[Frontend menampilkan sukses]
    L -. Error database/sistem .-> Z[ROLLBACK di pool.js]
    Z --> AA[error.middleware.js\n500 INTERNAL_ERROR]
    AA --> G
```

## Apa yang frontend kirim

Frontend tidak mengirim saldo baru. Frontend hanya mengirim **perintah transfer** berikut:

```json
{
  "senderAccountId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "receiverAccountId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "amount": "25000.00",
  "currency": "IDR",
  "description": "Bayar makan"
}
```

Header wajib:

```http
Authorization: Bearer <token_login>
Idempotency-Key: transfer-andi-ke-budi-001
```

- `Authorization` menjawab: **siapa pengirim yang sedang login?**
- `senderAccountId` menjawab: **akun mana yang akan didebit?**
- `receiverAccountId` menjawab: **akun mana yang akan menerima?**
- `amount` adalah nominal sebagai string agar nilai uang tidak terkena masalah pembulatan JavaScript.
- `Idempotency-Key` menjawab: **apakah ini retry dari perintah yang sama?** Key yang sama tidak boleh membuat potongan saldo kedua kali.

## Diagram login

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant AR as auth.routes.js
    participant AC as auth.controller.js
    participant AS as auth.service.js
    participant DB as users table

    FE->>AR: POST /api/auth/login (email, password)
    AR->>AC: login()
    AC->>AS: data login yang sudah divalidasi
    AS->>DB: cari user berdasarkan email
    DB-->>AS: user + password_hash
    AS->>AS: bcryptjs.compare(password, hash)
    alt password benar dan user aktif
        AS-->>AC: JWT token + data user
        AC-->>FE: 200 token
    else salah atau tidak aktif
        AS-->>AC: AppError 401/403
        AC-->>FE: error.middleware.js mengirim JSON error
    end
```

## Diagram ketika request dikirim dua kali

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as transaction.service.js
    participant DB as transactions table

    FE->>API: Transfer + Idempotency-Key: A-001
    API->>DB: Simpan transaksi (actor_user_id, A-001)
    DB-->>API: transaksi baru, proses saldo sekali
    API-->>FE: SUCCESS atau FAILED

    FE->>API: Retry request yang sama + Idempotency-Key: A-001
    API->>DB: INSERT konflik pada key unik
    DB-->>API: transaksi lama
    API-->>FE: hasil transaksi lama, saldo tidak diproses ulang
```

## Diagram refund

```mermaid
flowchart LR
    A[Admin mengirim POST /:id/refund] --> B[requireAuth + requireAdmin]
    B --> C[transaction.service.js]
    C --> D{Transaksi awal SUCCESS\ndan belum pernah refund?}
    D -- Tidak --> E[Error 404 / 422]
    D -- Ya --> F[Buat transaksi REFUND]
    F --> G[Debit akun penerima lama]
    G --> H[Credit akun pengirim lama]
    H --> I[2 ledger entries]
    I --> J[Refund SUCCESS\nTransaksi awal = REFUNDED]
```

Refund tidak menghapus transaksi awal. Ia membuat transaksi kebalikan agar jejak audit tetap ada.

## Peta file dan tugasnya

| File | Saat dipakai | Apa yang dilakukan | Lanjut ke / hasil |
| --- | --- | --- | --- |
| `src/server.js` | Saat `npm run dev` | Memeriksa koneksi database dan menyalakan server. | Memuat `app.js`. Bila DB tidak bisa dihubungi, server berhenti. |
| `src/app.js` | Setiap HTTP request | Mengaktifkan pembaca JSON, memasang endpoint dan error handler. | Mengarahkan `/api/auth` dan `/api/transactions` ke routes. |
| `src/routes/auth.routes.js` | `POST /api/auth/login` | Memilih controller login dan menangkap error async. | Ke `auth.controller.js`. |
| `src/routes/transaction.routes.js` | Endpoint transaksi | Menentukan URL transaksi dan memasang `requireAuth`; refund juga memakai `requireAdmin`. | Ke middleware, lalu controller. |
| `src/middleware/auth.middleware.js` | Sebelum controller transaksi | Membaca `Authorization: Bearer ...`, memverifikasi JWT, mengisi `req.user`. | Token benar → controller. Salah → `error.middleware.js` dengan 401. |
| `src/middleware/error.middleware.js` | Bila file lain memanggil `next(error)` atau melempar error | Mengubah error menjadi JSON konsisten. | Mengirim 400, 401, 403, 409, 422, atau 500 ke frontend. |
| `src/controllers/auth.controller.js` | Saat login | Memeriksa format email/password dengan Zod. | Ke `auth.service.js`. Format salah → error handler. |
| `src/controllers/transaction.controller.js` | Saat transfer/refund | Memeriksa body transfer dan header `Idempotency-Key`; menentukan status respons HTTP. | Ke `transaction.service.js`. |
| `src/services/auth.service.js` | Setelah controller login | Mencari user, memeriksa password hash, membuat JWT. | Ke tabel `users`; sukses → token, salah → error. |
| `src/services/transaction.service.js` | Setelah controller transfer/refund | Seluruh aturan uang: cek user, kepemilikan akun, saldo, lock akun, ledger, idempotensi, refund. | Ke `pool.js` dan tabel transaksi. |
| `src/db/pool.js` | Saat service perlu database | Membuat koneksi PostgreSQL dan fungsi `BEGIN`/`COMMIT`/`ROLLBACK`. | Sukses → commit; error sistem → rollback. |
| `src/errors/app-error.js` | Saat aturan bisnis gagal | Bentuk error dengan kode HTTP dan kode bisnis. | Ditangkap error middleware. |
| `src/config/env.js` | Saat server mulai | Membaca `.env`, mewajibkan `DATABASE_URL` dan `JWT_SECRET`. | Jika belum ada, server gagal mulai dengan pesan jelas. |
| `db/init/001-schema.sql` | Saat database baru dibuat | Membuat tipe enum, `users`, `accounts`, `transactions`, dan `ledger_entries`. | Menjadi struktur data PostgreSQL. |
| `db/init/002-seed.sql` | Sesudah schema dibuat | Mengisi Andi, Budi, admin, serta saldo awal untuk belajar. | Data siap dipakai login/transfer. |
| `docker-compose.yml` | Saat `docker compose up -d` | Menjalankan PostgreSQL dan otomatis menjalankan dua file SQL awal. | Database `transaksi_db` aktif pada port 5432. |
| `.env.example` | Sebelum menjalankan API | Contoh variabel koneksi database dan rahasia JWT. | Disalin menjadi `.env`. |
| `package.json` | Saat memasang/menjalankan proyek | Daftar library dan perintah `npm run dev`, `npm start`, `npm run check`. | Node.js menjalankan server. |
| `package-lock.json` | Saat `npm install` | Mengunci versi paket yang dipasang. | Jangan diedit manual. |
| `.gitignore` | Saat memakai Git | Mencegah `node_modules` dan `.env` ikut disimpan. | Rahasia tidak ikut terunggah. |
| `README.md` | Saat belajar/menjalankan | Ringkasan setup, contoh request, dan penjelasan desain. | Referensi singkat proyek. |

## Jalur salah: file mana yang menangani?

| Masalah | Berhenti di file | Apa yang terjadi pada saldo | Respons frontend |
| --- | --- | --- | --- |
| Token kosong/salah | `auth.middleware.js` → `error.middleware.js` | Tidak berubah. | `401 UNAUTHENTICATED` |
| Body JSON tidak valid | `app.js` → `error.middleware.js` | Tidak berubah. | `400` |
| ID akun atau amount salah | `transaction.controller.js` → `error.middleware.js` | Tidak berubah. | `400 VALIDATION_ERROR` |
| Akun pengirim bukan milik user login | `transaction.service.js` → `error.middleware.js` | Tidak berubah; transaksi dicatat `FAILED`. | `403 SENDER_NOT_OWNED` |
| Saldo kurang | `transaction.service.js` → `error.middleware.js` | Tidak berubah; transaksi dicatat `FAILED`. | `422 INSUFFICIENT_BALANCE` |
| Database putus/error sistem | `pool.js` melakukan `ROLLBACK` → `error.middleware.js` | Semua perubahan request itu dibatalkan. | `500 INTERNAL_ERROR` |
| Request dikirim ulang | `transaction.service.js` memeriksa key unik di tabel `transactions` | Tidak dipotong kedua kali. | Hasil transaksi sebelumnya |
