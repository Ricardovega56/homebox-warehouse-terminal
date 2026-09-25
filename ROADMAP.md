# Homebox Warehouse Terminal (HWT) & HMS Roadmap

Live task tracking on GitHub: **[GitHub Issues](https://github.com/Ricardovega56/homebox-warehouse-terminal/issues)** | **[Milestones](https://github.com/Ricardovega56/homebox-warehouse-terminal/milestones)**

---

## ✅ Milestone 1: Frictionless Intake Engine V2 (Completed)
*Goal: Eliminate friction so sorting messy boxes, Amazon deliveries, and garage bins takes <5 seconds per item.*

- [x] **[#1] Global Barcode (UPC/EAN) Auto-Resolution**: Scan manufacturer barcodes on retail boxes (screws, tools, consumables) $\rightarrow$ auto-fetches name, brand, and photo from Open Food Facts / UPCitemdb via companion proxy.
- [x] **[#2] Pre-Printed Serialized Label Mode ("Slap & Bind")**: Print 20–50 blank labels in batch $\rightarrow$ slap label on box $\rightarrow$ scan label $\rightarrow$ quick-name $\rightarrow$ drop in bin (zero printer wait time).
- [x] **[#3] Continuous Batch Delivery Hopper**: Multi-package receiving stream into an intake hopper with 1-tap strip printing or store-all.
- [x] **[#4] Voice-to-Item Quick Dictation**: Web Speech API hands-free capture (*"Box of 2-inch drywall screws, quantity 100"* -> auto extracts name & qty).

---

## 🏭 Milestone 2: Industrial Density & Hardware Keybindings
*Goal: Genuine warehouse ergonomics (anti-vibe-coding, 100% density, physical wedge controls).*

- [ ] **High-Density Tabular Manifest View**: Compact 34px data rows for bin contents, left-aligned names, right-aligned monospace numbers.
- [ ] **Hardware Wedge Keybindings**: Full keyboard operation (`Enter` = commit, `Esc` = cancel, `+ / -` = count steppers, `Tab` = switch bin).
- [ ] **Zebra ZPL Printer Driver**: Native socket/serial ZPL command generator in `relay/printers.py`.

---

## 📡 Milestone 3: Outbound Notification Hub & Maintenance Radar
*Goal: Self-hosted push alerts for overdue household lifecycles and par replenishment.*

- [ ] **Self-Hosted Push Dispatcher**: Outbound webhooks to **ntfy.sh** or local push server when stock drops below par or maintenance is due.
- [ ] **Custom Maintenance Schedules**: Add custom household tasks (HVAC filters, 3D printer lube, espresso descale, smoke detectors) directly in the UI.

---

## 🏠 Milestone 4: HMS Central Hub & Event Bus
*Goal: The overarching Home Management System umbrella in `/home-management-system`.*

- [ ] Central SQLite / Event Bus syncing physical warehouse inventory, groceries, and maintenance.
- [ ] Unified Household Assistant & Search index.
