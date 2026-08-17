import { Injectable, Logger } from '@nestjs/common';
import * as xlsx from 'xlsx';

export interface BankMovementRow {
  item: number | null;
  concept: string;
  reference: string;
  paymentAmount: number;
  paymentFolio: string;
  paymentDate: string;
  paymentTime: string;
  paymentType: string;
  rawRow: Record<string, any>;
}

@Injectable()
export class ExcelParserService {
  private readonly logger = new Logger(ExcelParserService.name);

  /**
   * Parsea un archivo de Excel del banco subido por la cajera.
   * Utiliza las reglas estrictas para leer del rango A1:H4 de Hoja1
   * y normaliza los formatos de fecha, hora y pagos.
   */
  parseBankExcel(fileBuffer: Buffer): BankMovementRow[] {
    // cellDates: true permite que xlsx convierta números seriales de fecha a objetos Date automáticamente
    const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });

    const sheetName = 'Hoja1';
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(`No se encontró la hoja '${sheetName}' en el archivo.`);
    }

    // El requerimiento establece exclusivamente el rango A1:H4
    // Rango de datos A2:H4 considerando que A1:H1 son los encabezados
    const rows = xlsx.utils.sheet_to_json<Record<string, any>>(sheet, {
      header: 'A',
      range: 'A2:H4',
      raw: true,
    });

    const parsedMovements: BankMovementRow[] = rows.map((row) => {
      // Ignoramos errores ortográficos en Concepto y extraemos limpiamente usando las letras de columnas
      const itemRaw = row['A'];
      const conceptRaw = row['B'];
      const referenceRaw = row['C'];
      const paymentRaw = row['D'];
      const folioRaw = row['E'];
      const dateRaw = row['F'];
      const timeRaw = row['G'];
      const typeRaw = row['H'];

      return {
        item: typeof itemRaw === 'number' ? itemRaw : null,
        concept: conceptRaw ? String(conceptRaw).trim() : '',
        reference: referenceRaw ? String(referenceRaw).trim() : '',
        paymentAmount: this.normalizePayment(paymentRaw),
        paymentFolio: folioRaw ? String(folioRaw).trim() : '',
        paymentDate: this.normalizeDate(dateRaw),
        paymentTime: this.normalizeTime(timeRaw),
        paymentType: typeRaw ? String(typeRaw).trim() : '',
        rawRow: row,
      };
    });

    return parsedMovements;
  }

  /**
   * Extrae limpiamente el monto de pago (Columna D)
   */
  private normalizePayment(val: any): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const clean = val.replace(/[$,\s]/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  /**
   * Normaliza la columna 'Fecha de pago' (Columna F) soportando tanto texto como
   * números seriales de Excel (que xlsx convierte a Date por cellDates: true).
   */
  private normalizeDate(val: any): string {
    if (!val) return '';

    if (val instanceof Date) {
      // Formatear el JS Date a YYYY-MM-DD
      const year = val.getFullYear();
      const month = String(val.getMonth() + 1).padStart(2, '0');
      const day = String(val.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    if (typeof val === 'string') {
      const trimmed = val.trim();
      // Si el formato viene como DD/MM/YYYY
      const parts = trimmed.split(/[\/\-]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          return trimmed; // Ya viene YYYY-MM-DD
        }
        const [day, month, year] = parts;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      return trimmed;
    }

    return String(val);
  }

  /**
   * Convierte la fracción de día de la columna 'Hora' (Columna G) a formato estándar HH:mm
   */
  private normalizeTime(val: any): string {
    if (val == null) return '';

    if (typeof val === 'number') {
      // Fracción de día, e.g., 0.5 -> 12:00
      const totalSeconds = Math.round(val * 86400);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    if (val instanceof Date) {
      const hours = String(val.getUTCHours()).padStart(2, '0');
      const minutes = String(val.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }

    if (typeof val === 'string') {
      // Limpiar posible formato am/pm o texto extra
      const trimmed = val.trim();
      // Si viene con tilde de aprox como en el archivo "≈13:25"
      const cleaned = trimmed.replace(/[^0-9:]/g, '');
      return cleaned;
    }

    return String(val);
  }
}
