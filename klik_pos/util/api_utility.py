# transaction_number.py
import frappe
import re
from typing import Optional, Union

def get_next_transaction_number(doctype: str, fieldname: str = 'trans_no', prefix: Optional[str] = None, padding: int = 3) -> str:
    """
    Generate the next transaction number for a given doctype.
    
    Args:
        doctype: Name of the DocType (e.g., 'Sales Invoice', 'IPO')
        fieldname: Field name that stores the transaction number (default: 'trans_no')
        prefix: Optional prefix (e.g., 'IPO'). If None, auto-detects from existing records
        padding: Number of digits for padding (default: 3, gives 001, 002, etc.)
    
    Returns:
        Next transaction number as string
    
    Examples:
        # Pure integers (8000 -> 8001)
        >>> get_next_transaction_number('Sales Invoice')
        '8001'
        
        # Prefixed (IPO-001 -> IPO-002)
        >>> get_next_transaction_number('IPO', prefix='IPO')
        'IPO-002'
        
        # Auto-detect prefix from existing records
        >>> get_next_transaction_number('IPO')
        'IPO-002'
        
        # Custom padding (INV-0001 -> INV-0002)
        >>> get_next_transaction_number('Invoice', prefix='INV', padding=4)
        'INV-0002'
    """
    
    # Get all existing transaction numbers
    existing_numbers = frappe.db.get_all(
        doctype,
        filters={fieldname: ['!=', '']},
        pluck=fieldname,
        order_by=fieldname,
        limit_page_length=None
    )
    
    if not existing_numbers:
        # No existing numbers, start from 1
        if prefix:
            return f"{prefix}-{str(1).zfill(padding)}"
        return str(1)
    
    # Case 1: Specific prefix provided
    if prefix:
        return _get_next_prefixed_number(existing_numbers, prefix, padding)
    
    # Case 2: Auto-detect from existing numbers
    return _get_next_auto_detected_number(existing_numbers, padding)


def get_next_integer(doctype: str, fieldname: str = 'trans_no') -> int:
    """
    Simplified: Get next integer only (no prefix)
    
    Args:
        doctype: Name of the DocType
        fieldname: Field name (default: 'trans_no')
    
    Returns:
        Next integer
    
    Example:
        >>> get_next_integer('Sales Invoice')
        8001
    """
    existing = frappe.db.get_all(
        doctype,
        filters={fieldname: ['!=', '']},
        pluck=fieldname,
        limit_page_length=None
    )
    
    integers = []
    for num in existing:
        num_str = str(num)
        if num_str.isdigit():
            integers.append(int(num_str))
    
    if not integers:
        return 1
    return max(integers) + 1


def get_next_prefixed(doctype: str, prefix: str, fieldname: str = 'trans_no', padding: int = 3) -> str:
    """
    Simplified: Get next prefixed number
    
    Args:
        doctype: Name of the DocType
        prefix: Prefix to use (e.g., 'IPO')
        fieldname: Field name (default: 'trans_no')
        padding: Number of digits for padding (default: 3)
    
    Returns:
        Next prefixed number as string
    
    Example:
        >>> get_next_prefixed('IPO', 'IPO')
        'IPO-002'
    """
    existing = frappe.db.get_all(
        doctype,
        filters={
            fieldname: ['like', f'{prefix}-%']
        },
        pluck=fieldname,
        limit_page_length=None
    )
    
    numbers = []
    for num in existing:
        num_str = str(num)
        match = re.search(r'\d+$', num_str)
        if match:
            numbers.append(int(match.group()))
    
    if not numbers:
        next_num = 1
    else:
        next_num = max(numbers) + 1
    
    return f"{prefix}-{str(next_num).zfill(padding)}"


def _get_next_prefixed_number(existing_numbers: list, prefix: str, padding: int) -> str:
    """Get next number for a specific prefix"""
    numbers = []
    pattern = re.compile(rf'^{re.escape(prefix)}[-_]?(\d+)$')
    
    for num in existing_numbers:
        num_str = str(num)
        match = pattern.match(num_str)
        if match:
            numbers.append(int(match.group(1)))
    
    if not numbers:
        next_num = 1
    else:
        next_num = max(numbers) + 1
    
    return f"{prefix}-{str(next_num).zfill(padding)}"


def _get_next_auto_detected_number(existing_numbers: list, padding: int) -> str:
    """
    Auto-detect whether to use integers or prefixed numbers
    """
    integer_numbers = []
    prefixed_numbers = {}
    
    for num in existing_numbers:
        num_str = str(num)
        
        # Check if pure integer
        if num_str.isdigit():
            integer_numbers.append(int(num_str))
        else:
            # Try to extract prefix and number
            match = re.match(r'^([A-Za-z]+)[-_]?(\d+)$', num_str)
            if match:
                pfx = match.group(1)
                numeric = int(match.group(2))
                
                if pfx not in prefixed_numbers:
                    prefixed_numbers[pfx] = []
                prefixed_numbers[pfx].append(numeric)
    
    # Decide which type to generate
    if integer_numbers:
        # Use integer sequence
        next_number = max(integer_numbers) + 1
        return str(next_number)
    elif prefixed_numbers:
        # Use the prefix with most records
        most_common_prefix = max(prefixed_numbers.items(), key=lambda x: len(x[1]))[0]
        next_number = max(prefixed_numbers[most_common_prefix]) + 1
        return f"{most_common_prefix}-{str(next_number).zfill(padding)}"
    else:
        # No valid pattern found, start with integer 1
        return str(1)


def preview_next_number(doctype: str, fieldname: str = 'trans_no', prefix: Optional[str] = None) -> dict:
    """
    Preview what the next number would be without generating anything
    
    Args:
        doctype: Name of the DocType
        fieldname: Field name (default: 'trans_no')
        prefix: Optional prefix
    
    Returns:
        Dictionary with details about the next number
    """
    existing = frappe.db.get_all(
        doctype,
        filters={fieldname: ['!=', '']},
        pluck=fieldname,
        limit_page_length=None
    )
    
    result = {
        'doctype': doctype,
        'total_records': len(existing),
        'next_number': None,
        'pattern_type': None,
        'suggested_prefix': None
    }
    
    if not existing:
        result['next_number'] = get_next_transaction_number(doctype, fieldname, prefix)
        result['pattern_type'] = 'new_sequence'
        return result
    
    # Analyze existing pattern
    has_integers = any(str(n).isdigit() for n in existing)
    prefixes = set()
    
    for num in existing:
        num_str = str(num)
        match = re.match(r'^([A-Za-z]+)[-_]?(\d+)$', num_str)
        if match:
            prefixes.add(match.group(1))
    
    result['has_integers'] = has_integers
    result['found_prefixes'] = list(prefixes)
    
    if has_integers:
        result['pattern_type'] = 'integer_sequence'
    elif prefixes:
        result['pattern_type'] = 'prefixed_sequence'
        result['suggested_prefix'] = list(prefixes)[0]
    
    result['next_number'] = get_next_transaction_number(doctype, fieldname, prefix)
    
    return result