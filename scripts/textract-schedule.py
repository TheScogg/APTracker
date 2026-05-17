#!/usr/bin/env python3
"""Scan schedule PDFs with Amazon Textract — no S3 needed.

Splits PDF into page images, sends each to Textract's synchronous
DetectDocumentText API, and outputs markdown tables for detected tables + raw text.

Usage:
  python textract-schedule.py schedule.pdf
  python textract-schedule.py schedule.pdf --region us-east-1 --output results.txt

Requires:
  pip install boto3 PyMuPDF
  AWS credentials configured (env vars, ~/.aws/credentials, or --profile)
"""

import argparse
import base64
import io
import json
import os
import sys
import time

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF not found. Install: pip install PyMuPDF")
    sys.exit(1)

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:
    print("boto3 not found. Install: pip install boto3")
    sys.exit(1)


def pdf_page_to_bytes(pdf_path, page_num, dpi=150):
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    pix = page.get_pixmap(dpi=dpi)
    img_bytes = pix.tobytes("jpg")
    doc.close()
    return img_bytes


def analyze_page(textract, image_bytes):
    resp = textract.analyze_document(
        Document={'Bytes': image_bytes},
        FeatureTypes=['TABLES']
    )
    return resp.get('Blocks', [])


def blocks_to_lines(blocks):
    lines = []
    block_map = {}
    for b in blocks:
        block_map[b['Id']] = b

    for b in blocks:
        if b['BlockType'] == 'LINE':
            lines.append(b['Text'])
        elif b['BlockType'] == 'TABLE':
            lines.append(format_table(b, block_map))
            lines.append('')
    return lines


def format_table(table_block, block_map):
    cells = {}
    for rel in table_block.get('Relationships', []):
        if rel['Type'] == 'CHILD':
            for cid in rel['Ids']:
                cell = block_map.get(cid)
                if cell and cell['BlockType'] == 'CELL':
                    r = cell.get('RowIndex', 1) - 1
                    c = cell.get('ColumnIndex', 1) - 1
                    cells[(r, c)] = cell.get('Text', '')
    if not cells:
        return '[table with no cells]'

    max_r = max(r for r, c in cells) + 1
    max_c = max(c for r, c in cells) + 1
    col_widths = [0] * max_c
    for (r, c), text in cells.items():
        col_widths[c] = max(col_widths[c], len(text))

    out = []
    for r in range(max_r):
        row = []
        for c in range(max_c):
            cell = cells.get((r, c), '')
            row.append(cell.ljust(col_widths[c]))
        out.append('| ' + ' | '.join(row) + ' |')
        if r == 0:
            out.append('|-' + '-|-'.join('-' * col_widths[c] for c in range(max_c)) + '-|')
    return '\n'.join(out)


def main():
    parser = argparse.ArgumentParser(description='OCR schedule PDFs with Amazon Textract (no S3)')
    parser.add_argument('input', help='PDF file to process')
    parser.add_argument('--region', default=os.environ.get('AWS_REGION', 'us-west-2'))
    parser.add_argument('--dpi', type=int, default=150, help='PDF render DPI (default: 150)')
    parser.add_argument('-o', '--output', help='Write to file instead of stdout')
    parser.add_argument('--profile', help='AWS profile name (from ~/.aws/credentials)')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    session = boto3.session.Session(profile_name=args.profile) if args.profile else boto3.session.Session()
    textract = session.client('textract', region_name=args.region)

    doc = fitz.open(args.input)
    total_pages = len(doc)
    doc.close()

    output_lines = []
    for page_num in range(total_pages):
        label = f"=== {os.path.basename(args.input)} (page {page_num + 1}) ==="
        print(f"\n{label}\n", file=sys.stderr)
        output_lines.append(label)
        output_lines.append('')

        try:
            print(f"  Rendering page {page_num + 1}/{total_pages} at {args.dpi} DPI...", file=sys.stderr)
            image_bytes = pdf_page_to_bytes(args.input, page_num, args.dpi)

            print(f"  Sending to Textract ({len(image_bytes)} bytes)...", file=sys.stderr)
            blocks = analyze_page(textract, image_bytes)

            page_lines = blocks_to_lines(blocks)
            if page_lines:
                output_lines.extend(page_lines)
            else:
                output_lines.append("(no text detected)")
            output_lines.append('')

            print(f"  Done: {len(page_lines)} text items found.", file=sys.stderr)
        except ClientError as e:
            err = e.response['Error']
            print(f"  AWS error: {err['Code']} - {err['Message']}", file=sys.stderr)
            output_lines.append(f"[Textract error: {err['Code']}]")
            output_lines.append('')
        except Exception as e:
            print(f"  Error: {e}", file=sys.stderr)
            output_lines.append(f"[Error: {e}]")
            output_lines.append('')

    result = '\n'.join(output_lines)
    if args.output:
        with open(args.output, 'w') as f:
            f.write(result)
        print(f"\nWritten to {args.output}", file=sys.stderr)
    else:
        print(result)


if __name__ == '__main__':
    main()
