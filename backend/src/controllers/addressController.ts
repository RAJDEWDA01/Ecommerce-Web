import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address, { type IAddress } from '../models/Address.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';

interface AddressBody {
  label?: string;
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string | null;
  landmark?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  isDefault?: boolean;
}

const PHONE_PATTERN = /^[0-9+\-()\s]{7,20}$/;
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9 -]{3,12}$/;

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizeString(value);
  return normalized || null;
};

const sanitizeAddress = (address: IAddress) => ({
  id: address._id.toString(),
  label: address.label,
  fullName: address.fullName,
  phone: address.phone,
  line1: address.line1,
  line2: address.line2 ?? null,
  landmark: address.landmark ?? null,
  city: address.city,
  state: address.state,
  postalCode: address.postalCode,
  country: address.country,
  isDefault: address.isDefault,
  createdAt: address.createdAt,
  updatedAt: address.updatedAt,
});

const getCustomerObjectIdFromRequest = (req: Request): mongoose.Types.ObjectId | null => {
  const authReq = req as CustomerAuthRequest;
  const customerId = authReq.customer?.id;

  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
    return null;
  }

  return new mongoose.Types.ObjectId(customerId);
};

const validateRequiredField = (
  fieldValue: string,
  fieldName: string,
  maxLength: number
): string | null => {
  if (!fieldValue) {
    return `${fieldName} is required`;
  }

  if (fieldValue.length > maxLength) {
    return `${fieldName} must be ${maxLength} characters or less`;
  }

  return null;
};

const validatePhone = (phone: string): string | null => {
  if (!PHONE_PATTERN.test(phone)) {
    return 'Please provide a valid phone number';
  }

  return null;
};

const validatePostalCode = (postalCode: string): string | null => {
  if (!POSTAL_CODE_PATTERN.test(postalCode)) {
    return 'Please provide a valid postal code';
  }

  return null;
};

const ensureSingleDefaultAddress = async (customerId: mongoose.Types.ObjectId): Promise<void> => {
  const existingDefault = await Address.findOne({
    customer: customerId,
    isDefault: true,
  }).select('_id');

  if (existingDefault) {
    return;
  }

  const fallbackAddress = await Address.findOne({ customer: customerId })
    .sort({ updatedAt: -1 })
    .select('_id');

  if (!fallbackAddress) {
    return;
  }

  await Address.findByIdAndUpdate(fallbackAddress._id, {
    $set: {
      isDefault: true,
    },
  });
};

export const listCustomerAddresses = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectIdFromRequest(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const addresses = await Address.find({ customer: customerObjectId }).sort({ isDefault: -1, updatedAt: -1 });

    res.status(200).json({
      success: true,
      addresses: addresses.map(sanitizeAddress),
      count: addresses.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch addresses' });
  }
};

export const createCustomerAddress = async (
  req: Request<Record<string, string>, unknown, AddressBody>,
  res: Response
): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectIdFromRequest(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const label = normalizeString(req.body.label) || 'Home';
    const fullName = normalizeString(req.body.fullName);
    const phone = normalizeString(req.body.phone);
    const line1 = normalizeString(req.body.line1);
    const line2 = normalizeNullableString(req.body.line2);
    const landmark = normalizeNullableString(req.body.landmark);
    const city = normalizeString(req.body.city);
    const state = normalizeString(req.body.state);
    const postalCode = normalizeString(req.body.postalCode);
    const country = normalizeString(req.body.country) || 'India';

    const requiredFieldChecks = [
      validateRequiredField(label, 'label', 40),
      validateRequiredField(fullName, 'fullName', 120),
      validateRequiredField(phone, 'phone', 20),
      validateRequiredField(line1, 'line1', 160),
      line2 && line2.length > 160 ? 'line2 must be 160 characters or less' : null,
      landmark && landmark.length > 120 ? 'landmark must be 120 characters or less' : null,
      validateRequiredField(city, 'city', 80),
      validateRequiredField(state, 'state', 80),
      validateRequiredField(postalCode, 'postalCode', 12),
      validateRequiredField(country, 'country', 80),
      validatePhone(phone),
      validatePostalCode(postalCode),
    ];

    const firstError = requiredFieldChecks.find((value) => value !== null);

    if (firstError) {
      res.status(400).json({ success: false, message: firstError });
      return;
    }

    const existingAddressCount = await Address.countDocuments({ customer: customerObjectId });
    const shouldSetDefault = Boolean(req.body.isDefault) || existingAddressCount === 0;

    if (shouldSetDefault) {
      await Address.updateMany(
        { customer: customerObjectId, isDefault: true },
        {
          $set: {
            isDefault: false,
          },
        }
      );
    }

    const address = await Address.create({
      customer: customerObjectId,
      label,
      fullName,
      phone,
      line1,
      line2,
      landmark,
      city,
      state,
      postalCode,
      country,
      isDefault: shouldSetDefault,
    });

    res.status(201).json({
      success: true,
      message: 'Address created successfully',
      address: sanitizeAddress(address),
    });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      const customerObjectId = getCustomerObjectIdFromRequest(req);

      if (customerObjectId) {
        await ensureSingleDefaultAddress(customerObjectId);
      }

      res.status(409).json({
        success: false,
        message: 'Could not set default address due to a concurrent update. Please retry.',
      });
      return;
    }

    res.status(500).json({ success: false, message: 'Failed to create address' });
  }
};

export const updateCustomerAddress = async (
  req: Request<{ id: string }, unknown, AddressBody>,
  res: Response
): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectIdFromRequest(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid address id' });
      return;
    }

    const updates: Record<string, unknown> = {};

    if (req.body.label !== undefined) {
      const value = normalizeString(req.body.label);

      if (!value) {
        res.status(400).json({ success: false, message: 'label cannot be empty' });
        return;
      }

      if (value.length > 40) {
        res.status(400).json({ success: false, message: 'label must be 40 characters or less' });
        return;
      }

      updates.label = value;
    }

    if (req.body.fullName !== undefined) {
      const value = normalizeString(req.body.fullName);

      if (!value) {
        res.status(400).json({ success: false, message: 'fullName cannot be empty' });
        return;
      }

      if (value.length > 120) {
        res.status(400).json({ success: false, message: 'fullName must be 120 characters or less' });
        return;
      }

      updates.fullName = value;
    }

    if (req.body.phone !== undefined) {
      const value = normalizeString(req.body.phone);

      if (!value) {
        res.status(400).json({ success: false, message: 'phone cannot be empty' });
        return;
      }

      const phoneValidation = validatePhone(value);

      if (phoneValidation) {
        res.status(400).json({ success: false, message: phoneValidation });
        return;
      }

      updates.phone = value;
    }

    if (req.body.line1 !== undefined) {
      const value = normalizeString(req.body.line1);

      if (!value) {
        res.status(400).json({ success: false, message: 'line1 cannot be empty' });
        return;
      }

      if (value.length > 160) {
        res.status(400).json({ success: false, message: 'line1 must be 160 characters or less' });
        return;
      }

      updates.line1 = value;
    }

    if (req.body.line2 !== undefined) {
      const value = normalizeNullableString(req.body.line2);

      if (value && value.length > 160) {
        res.status(400).json({ success: false, message: 'line2 must be 160 characters or less' });
        return;
      }

      updates.line2 = value;
    }

    if (req.body.landmark !== undefined) {
      const value = normalizeNullableString(req.body.landmark);

      if (value && value.length > 120) {
        res.status(400).json({ success: false, message: 'landmark must be 120 characters or less' });
        return;
      }

      updates.landmark = value;
    }

    if (req.body.city !== undefined) {
      const value = normalizeString(req.body.city);

      if (!value) {
        res.status(400).json({ success: false, message: 'city cannot be empty' });
        return;
      }

      if (value.length > 80) {
        res.status(400).json({ success: false, message: 'city must be 80 characters or less' });
        return;
      }

      updates.city = value;
    }

    if (req.body.state !== undefined) {
      const value = normalizeString(req.body.state);

      if (!value) {
        res.status(400).json({ success: false, message: 'state cannot be empty' });
        return;
      }

      if (value.length > 80) {
        res.status(400).json({ success: false, message: 'state must be 80 characters or less' });
        return;
      }

      updates.state = value;
    }

    if (req.body.postalCode !== undefined) {
      const value = normalizeString(req.body.postalCode);

      if (!value) {
        res.status(400).json({ success: false, message: 'postalCode cannot be empty' });
        return;
      }

      if (value.length > 12) {
        res.status(400).json({ success: false, message: 'postalCode must be 12 characters or less' });
        return;
      }

      const postalCodeValidation = validatePostalCode(value);

      if (postalCodeValidation) {
        res.status(400).json({ success: false, message: postalCodeValidation });
        return;
      }

      updates.postalCode = value;
    }

    if (req.body.country !== undefined) {
      const value = normalizeString(req.body.country);

      if (!value) {
        res.status(400).json({ success: false, message: 'country cannot be empty' });
        return;
      }

      if (value.length > 80) {
        res.status(400).json({ success: false, message: 'country must be 80 characters or less' });
        return;
      }

      updates.country = value;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, message: 'No valid fields provided for update' });
      return;
    }

    const updatedAddress = await Address.findOneAndUpdate(
      {
        _id: id,
        customer: customerObjectId,
      },
      {
        $set: updates,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedAddress) {
      res.status(404).json({ success: false, message: 'Address not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      address: sanitizeAddress(updatedAddress),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update address' });
  }
};

export const setCustomerDefaultAddress = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectIdFromRequest(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid address id' });
      return;
    }

    const targetAddress = await Address.findOne({
      _id: id,
      customer: customerObjectId,
    });

    if (!targetAddress) {
      res.status(404).json({ success: false, message: 'Address not found' });
      return;
    }

    if (!targetAddress.isDefault) {
      await Address.updateMany(
        { customer: customerObjectId, isDefault: true },
        {
          $set: {
            isDefault: false,
          },
        }
      );

      targetAddress.isDefault = true;
      await targetAddress.save();
    }

    res.status(200).json({
      success: true,
      message: 'Default address updated successfully',
      address: sanitizeAddress(targetAddress),
    });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      const customerObjectId = getCustomerObjectIdFromRequest(req);

      if (customerObjectId) {
        await ensureSingleDefaultAddress(customerObjectId);
      }

      res.status(409).json({
        success: false,
        message: 'Could not set default address due to a concurrent update. Please retry.',
      });
      return;
    }

    res.status(500).json({ success: false, message: 'Failed to update default address' });
  }
};

export const deleteCustomerAddress = async (
  req: Request<{ id: string }>,
  res: Response
): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectIdFromRequest(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid address id' });
      return;
    }

    const deletedAddress = await Address.findOneAndDelete({
      _id: id,
      customer: customerObjectId,
    });

    if (!deletedAddress) {
      res.status(404).json({ success: false, message: 'Address not found' });
      return;
    }

    if (deletedAddress.isDefault) {
      await ensureSingleDefaultAddress(customerObjectId);
    }

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete address' });
  }
};
