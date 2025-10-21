-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Waktu pembuatan: 19 Okt 2025 pada 16.33
-- Versi server: 10.4.32-MariaDB
-- Versi PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `websiteawp_db`
--

-- --------------------------------------------------------

--
-- Struktur dari tabel `kamar_tersedia`
--

CREATE TABLE `kamar_tersedia` (
  `id` int(11) NOT NULL,
  `tipe_kamar` varchar(255) NOT NULL,
  `jumlah_tersedia` int(11) NOT NULL,
  `deskripsi` varchar(150) NOT NULL,
  `harga` varchar(100) DEFAULT NULL,
  `user_id` varchar(15) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data untuk tabel `kamar_tersedia`
--

INSERT INTO `kamar_tersedia` (`id`, `tipe_kamar`, `jumlah_tersedia`, `deskripsi`, `harga`, `user_id`) VALUES
(1, 'Kamar A', 1, 'ac oke', '760.000', '');

-- --------------------------------------------------------

--
-- Struktur dari tabel `laporan_keuangan`
--

CREATE TABLE `laporan_keuangan` (
  `id_pembayaran` int(11) NOT NULL,
  `tanggal_pembayaran` datetime DEFAULT NULL,
  `tipe_kamar` varchar(255) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `user_id` int(15) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data untuk tabel `laporan_keuangan`
--

INSERT INTO `laporan_keuangan` (`id_pembayaran`, `tanggal_pembayaran`, `tipe_kamar`, `username`, `user_id`) VALUES
(10, '2025-10-13 14:06:08', 'Kamar A', NULL, 1),
(11, '2025-10-13 14:17:29', 'Kamar A', NULL, 1);

-- --------------------------------------------------------

--
-- Struktur dari tabel `sewa_kamar`
--

CREATE TABLE `sewa_kamar` (
  `id` int(11) NOT NULL,
  `first_name` varchar(255) DEFAULT NULL,
  `last_name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `tanggal_sewa` date DEFAULT NULL,
  `tipe_kamar` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `user_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `users`
--

CREATE TABLE `users` (
  `user_id` int(15) NOT NULL,
  `username` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `first_name` varchar(255) DEFAULT NULL,
  `last_name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `role` varchar(50) DEFAULT NULL,
  `google_id` varchar(255) DEFAULT NULL,
  `phone_number` varchar(15) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data untuk tabel `users`
--

INSERT INTO `users` (`user_id`, `username`, `password`, `first_name`, `last_name`, `email`, `dob`, `role`, `google_id`, `phone_number`) VALUES
(1, 'yowyow', '$2b$10$lM3d1NpKs3dKHF3hJnUUaORIRSPGiQZnmV.eZ61jCkIyupHZQoGhe', 'Claudia', 'Vidya', 'claudia.vidya@student.umn.ac.id', '2025-10-12', 'user', '113264113607993303051', '081281798168'),
(2, 'yes', '$2b$10$bXK1aRRDhwyU9PLPBOs5m.ubrRKM/ocmZGCICXHY0asE2GsuuM2mG', 'Claudia', 'Vidya', 'claudia@student.umn.ac.id', '2025-10-12', 'admin', NULL, '0812381798168'),
(14, 'claudiavidya26', '', 'Starlight', 'Vlynley', 'claudiavidya26@gmail.com', NULL, 'user', '100341905599221679791', NULL),
(15, 'eligrahp', '', 'Eligrah', 'Philip', 'eligrahp@gmail.com', NULL, 'user', '116700589100990560005', NULL),
(16, 'Mark', '$2b$10$3dgk.kVaFxq1O5gHhebjCOyDF8eSGq/21QirvCMTp4eser9CQuNsq', 'Mark', 'Kidson', 'markkidson@gmail.com', '1994-10-19', 'user', NULL, NULL),
(17, 'eligrahphilipmapakogoya', '', 'Eligrah Philip', 'Mapa Kogoya', 'eligrahphilipmapakogoya@gmail.com', NULL, 'user', '114046558889339990087', NULL);

--
-- Indexes for dumped tables
--

--
-- Indeks untuk tabel `kamar_tersedia`
--
ALTER TABLE `kamar_tersedia`
  ADD PRIMARY KEY (`id`);

--
-- Indeks untuk tabel `laporan_keuangan`
--
ALTER TABLE `laporan_keuangan`
  ADD PRIMARY KEY (`id_pembayaran`),
  ADD KEY `username` (`username`),
  ADD KEY `user_id` (`user_id`);

--
-- Indeks untuk tabel `sewa_kamar`
--
ALTER TABLE `sewa_kamar`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indeks untuk tabel `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `google_id` (`google_id`);

--
-- AUTO_INCREMENT untuk tabel yang dibuang
--

--
-- AUTO_INCREMENT untuk tabel `kamar_tersedia`
--
ALTER TABLE `kamar_tersedia`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT untuk tabel `laporan_keuangan`
--
ALTER TABLE `laporan_keuangan`
  MODIFY `id_pembayaran` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT untuk tabel `sewa_kamar`
--
ALTER TABLE `sewa_kamar`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(15) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;

--
-- Ketidakleluasaan untuk tabel pelimpahan (Dumped Tables)
--

--
-- Ketidakleluasaan untuk tabel `laporan_keuangan`
--
ALTER TABLE `laporan_keuangan`
  ADD CONSTRAINT `laporan_keuangan_ibfk_1` FOREIGN KEY (`username`) REFERENCES `users` (`username`),
  ADD CONSTRAINT `laporan_keuangan_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

--
-- Ketidakleluasaan untuk tabel `sewa_kamar`
--
ALTER TABLE `sewa_kamar`
  ADD CONSTRAINT `sewa_kamar_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
