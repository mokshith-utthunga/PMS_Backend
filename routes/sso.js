import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { generateToken, setAuthCookies, clearAuthCookies } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_SSO_ROLES = ['employee', 'admin', 'hr', 'manager', 'bu_head'];


const mapSSORoleToDBRole = (ssoRole) => {
  const roleMap = {
    'employee': 'employee',
    'admin': 'system_admin',
    'hr': 'hr_admin',
    'manager': 'manager',
    'bu_head': 'dept_head'
  };
  
  return roleMap[ssoRole] || 'employee'; 
};


const isValidSSORole = (role) => {
  return role && ALLOWED_SSO_ROLES.includes(role.toLowerCase());
};





router.get('/', async (req, res) => {
  try {
    const { 
      email, 
      employeeCode,
      fullName,
      role
    } = req.query;
    // If SSO parameters are provided, process SSO login
    if (email && employeeCode) {
      // Validate required fields
      if (!email) {
        return res.redirect('/login?error=missing_email');
      }

      if (!employeeCode) {
        return res.redirect('/login?error=missing_employee_code');
      }

      // Decode URL-encoded fullName
      const decodedFullName = fullName ? decodeURIComponent(fullName) : null;

      // Validate and map role
      const ssoRole = role ? role.toLowerCase() : 'employee';
      const dbRole = isValidSSORole(ssoRole) ? mapSSORoleToDBRole(ssoRole) : 'employee';

      // Check if user exists
      let result = await query(
        'SELECT id, email, full_name, role FROM profiles WHERE email = $1',
        [email]
      );

      let user;
      let profileId;

      if (result.rows.length === 0) {
        // Create new user from SSO
        profileId = uuidv4();
        
        await query(
          `INSERT INTO profiles (id, email, password_hash, full_name, role, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::app_role, NOW(), NOW())`,
          [profileId, email, '$2a$10$clM9J17.jlifVSLGXaVTSe3MErkZwTlE6Y/.6RWKBnLqta2ynnAA6', decodedFullName || null, dbRole]
        );

        user = { id: profileId, email, full_name: decodedFullName || null, role: dbRole };
      } else {
        // Update existing user
        profileId = result.rows[0].id;
        await query(
          `UPDATE profiles 
           SET full_name = COALESCE($1, full_name), 
               role = $2::app_role,
               email = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [decodedFullName || null, dbRole, email, profileId]
        );

        user = { 
          id: profileId, 
          email, 
          full_name: decodedFullName || result.rows[0].full_name || null,
          role: dbRole
        };
      }

      // Handle employee record
      // Priority: Check by emp_code first, then by email
      // let existingEmployee = null;
      // const empByCodeResult = await query(
      //   'SELECT * FROM employees WHERE emp_code = $1',
      //   [employeeCode]
      // );

      // if (empByCodeResult.rows.length > 0) {
      //   // Employee exists with this emp_code - update it
      //   existingEmployee = empByCodeResult.rows[0];
      //   await query(
      //     `UPDATE employees 
      //      SET profile_id = $1, email = $2,department = $3, sub_department = $4, manager_code = $5, business_unit = $6, grade = $7, location = $8, updated_at = NOW()
      //      WHERE id = $9`,
      //     [profileId, email, userMasterData.department?.trim(), userMasterData.subDepartment?.trim(), userMasterData.reportingManagerCode, userMasterData.businessUnit||'Unassigned', userMasterData.grade||'Unassigned', userMasterData.location||'Unassigned', existingEmployee.id]
      //   );
      // } else {
      //   // Check by email
      //   const empByEmailResult = await query(
      //     'SELECT * FROM employees WHERE email = $1',
      //     [email]
      //   );

      //   if (empByEmailResult.rows.length > 0) {
      //     // Employee exists with this email but different emp_code
      //     // Update emp_code if it's not already taken
      //     existingEmployee = empByEmailResult.rows[0];
      //     try {
      //       await query(
      //         `UPDATE employees 
      //          SET emp_code = $1, profile_id = $2, department = $3, sub_department = $4, manager_code = $5, business_unit = $6, grade = $7, location = $8, updated_at = NOW()
      //          WHERE id = $9`,
      //         [employeeCode, profileId, userMasterData.department, userMasterData.subDepartment, userMasterData.reportingManagerCode, userMasterData.businessUnit||'Unassigned', userMasterData.grade||'Unassigned', userMasterData.location||'Unassigned', existingEmployee.id]
      //       );
      //     } catch (conflictError) {
      //       // If emp_code conflict, just update profile_id and email
      //       if (conflictError.message && conflictError.message.includes('emp_code')) {
      //         console.warn(`[SSO] Emp code ${employeeCode} already exists, updating profile_id only`);
      //         await query(
      //           `UPDATE employees SET profile_id = $1, email = $2, updated_at = NOW() WHERE id = $3`,
      //           [profileId, email, existingEmployee.id]
      //         );
      //       } else {
      //         throw conflictError;
      //       }
      //     }
      //   } else {
      //     // Create new employee record with minimal data
      //     // Will be enriched by User Master API call below
      //     userMasterData = await fetchEmployeeFromUserMaster(employeeCode);
      //     if (userMasterData) {
      //       await syncEmployeeDataFromUserMaster(profileId, employeeCode, userMasterData);
      //     }
      //     const employeeId = uuidv4();
      //     // try {
      //     //   await query(
      //     //     `INSERT INTO employees (id, emp_code, profile_id, full_name, email, department, 
      //     //      business_unit, grade, location, date_of_joining, created_at, updated_at)
      //     //      VALUES ($1, $2, $3, $4, $5, 'Unassigned', 'Unassigned', 'Unassigned', 'Unassigned', NOW(), NOW(), NOW())`,
      //     //     [employeeId, employeeCode, profileId, decodedFullName || 'User', email]
      //     //   );
      //     // } catch (conflictError) {
      //     //   // Handle conflict on emp_code - update existing record
      //     //   if (conflictError.message && conflictError.message.includes('emp_code')) {
      //     //     const conflictResult = await query(
      //     //       'SELECT * FROM employees WHERE emp_code = $1',
      //     //       [employeeCode]
      //     //     );
      //     //     if (conflictResult.rows.length > 0) {
      //     //       existingEmployee = conflictResult.rows[0];
      //     //       await query(
      //     //         `UPDATE employees SET profile_id = $1, email = $2, updated_at = NOW() WHERE emp_code = $3`,
      //     //           [profileId, email, employeeCode]
      //     //       );
      //     //     } else {
      //     //       throw conflictError;
      //     //     }
      //     //   } else {
      //     //     throw conflictError;
      //     //   }
      //     // }
      //   }
      // }


      const token = generateToken(user.id, user.email);
      setAuthCookies(res, token, user);

      const frontendOrigin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
      const redirectUrl = frontendOrigin && frontendOrigin.includes('localhost:8080') 
        ? `${frontendOrigin}/dashboard` 
        : process.env.FRONTEND_URL 
          ? `${process.env.FRONTEND_URL}/dashboard`
          : '/dashboard';

      // Redirect to dashboard
      return res.redirect(redirectUrl);
    }

    // If no SSO parameters, return info about available SSO options
    res.json({
      message: 'SSO Authentication Entry Point',
      available_methods: ['saml', 'oauth', 'oidc'],
      endpoints: {
        saml: '/external-auth/saml',
        oauth: '/external-auth/oauth',
        oidc: '/external-auth/oidc',
        callback: '/external-auth/callback'
      },
      usage: 'GET /external-auth?email=user@example.com&employeeCode=EMP001&fullName=John%20Doe&role=employee'
    });
  } catch (error) {
    console.error('SSO entry point error:', error);
    res.redirect('/login?error=sso_failed');
  }
});

// SSO Callback via POST - handles POST requests with body data (kept for backward compatibility)
// Note: Primary SSO endpoint is router.get('/') which handles GET with query parameters
router.post('/callback', async (req, res) => {
  try {
    const { 
      email, 
      employeeCode,
      fullName,
      role
    } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({ error: 'Email is required from SSO provider' });
    }

    if (!employeeCode) {
      return res.status(400).json({ error: 'Employee code is required from SSO provider' });
    }

    // Validate and map role
    const ssoRole = role ? role.toLowerCase() : 'employee';
    if (!isValidSSORole(ssoRole)) {
      console.warn(`[SSO] Invalid role received: ${role}, defaulting to employee`);
    }
    const dbRole = mapSSORoleToDBRole(ssoRole);

    let result = await query(
      'SELECT id, email, full_name, role FROM profiles WHERE email = $1',
      [email]
    );

    let user;
    let isNewUser = false;
    let profileId;

    if (result.rows.length === 0) {
      // Create new user from SSO
      isNewUser = true;
      profileId = uuidv4();
      
      // Create profile with role
      await query(
        `INSERT INTO profiles (id, email, password_hash, full_name, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::app_role, NOW(), NOW())`,
        [profileId, email, '$2a$10$clM9J17.jlifVSLGXaVTSe3MErkZwTlE6Y/.6RWKBnLqta2ynnAA6', fullName || null, dbRole]
      );

      user = { id: profileId, email, full_name: fullName || null, role: dbRole };
    } else {
      // Update existing user
      profileId = result.rows[0].id;
      await query(
        `UPDATE profiles 
         SET full_name = COALESCE($1, full_name), 
             role = $2::app_role,
             email = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [fullName || null, dbRole, email, profileId]
      );

      user = { 
        id: profileId, 
        email, 
        full_name: fullName || result.rows[0].full_name || null,
        role: dbRole
      };
    }

    let existingEmployee = null;
    const empByCodeResult = await query(
      'SELECT * FROM employees WHERE emp_code = $1',
      [employeeCode]
    );

    if (empByCodeResult.rows.length > 0) {
      // Employee exists with this emp_code - update it
      existingEmployee = empByCodeResult.rows[0];
      await query(
        `UPDATE employees 
         SET profile_id = $1, email = $2, updated_at = NOW()
         WHERE id = $3`,
        [profileId, email, existingEmployee.id]
      );
    } else {
      // Check by email
      const empByEmailResult = await query(
        'SELECT * FROM employees WHERE email = $1',
        [email]
      );

      if (empByEmailResult.rows.length > 0) {
        // Employee exists with this email but different emp_code
        // Update emp_code if it's not already taken
        existingEmployee = empByEmailResult.rows[0];
        try {
          await query(
            `UPDATE employees 
             SET emp_code = $1, profile_id = $2, updated_at = NOW()
             WHERE id = $3`,
            [employeeCode, profileId, existingEmployee.id]
          );
        } catch (conflictError) {
          // If emp_code conflict, just update profile_id and email
          if (conflictError.message && conflictError.message.includes('emp_code')) {
            console.warn(`[SSO] Emp code ${employeeCode} already exists, updating profile_id only`);
            await query(
              `UPDATE employees SET profile_id = $1, email = $2, updated_at = NOW() WHERE id = $3`,
              [profileId, email, existingEmployee.id]
            );
          } else {
            throw conflictError;
          }
        }
      } else {

        const employeeId = uuidv4();
        try {
          await query(
            `INSERT INTO employees (id, emp_code, profile_id, full_name, email, department, 
             business_unit, grade, location, date_of_joining, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'Unassigned', 'Unassigned', 'Unassigned', 'Unassigned', NOW(), NOW(), NOW())`,
            [employeeId, employeeCode, profileId, fullName || 'User', email]
          );
        } catch (conflictError) {
          // Handle conflict on emp_code - update existing record
          if (conflictError.message && conflictError.message.includes('emp_code')) {
            const conflictResult = await query(
              'SELECT * FROM employees WHERE emp_code = $1',
              [employeeCode]
            );
            if (conflictResult.rows.length > 0) {
              existingEmployee = conflictResult.rows[0];
              await query(
                `UPDATE employees SET profile_id = $1, email = $2, updated_at = NOW() WHERE emp_code = $3`,
                [profileId, email, employeeCode]
              );
            } else {
              throw conflictError;
            }
          } else {
            throw conflictError;
          }
        }
      }
    }


    // Generate token and set cookies
    const token = generateToken(user.id, user.email);
    setAuthCookies(res, token, user);

    // Return success response
    res.json({
      success: true,
      user,
      isNewUser,
      session: { access_token: token },
      redirectUrl: '/dashboard'
    });
  } catch (error) {
    console.error('SSO callback error:', error);
    res.status(500).json({ error: 'SSO authentication failed' });
  }
});

// SSO Callback via GET - handles GET requests with query parameters (kept for backward compatibility)
// Note: Primary SSO endpoint is router.get('/') which handles GET with query parameters
router.get('/callback', async (req, res) => {
  try {
    const { 
      token: ssoToken, 
      email, 
      employeeCode,
      fullName,
      role,
      state 
    } = req.query;

    if (!ssoToken || !email) {
      return res.redirect('/login?error=sso_failed');
    }

    if (!employeeCode) {
      return res.redirect('/login?error=missing_employee_code');
    }

    // Validate and map role
    const ssoRole = role ? role.toLowerCase() : 'employee';
    const dbRole = isValidSSORole(ssoRole) ? mapSSORoleToDBRole(ssoRole) : 'employee';

    // Validate SSO token (implement based on your provider)
    
    // Check if user exists
    let result = await query(
      'SELECT id, email, full_name, role FROM profiles WHERE email = $1',
      [email]
    );

    let user;
    let profileId;

    if (result.rows.length === 0) {
      // Create new user from SSO
      profileId = uuidv4();
      
      await query(
        `INSERT INTO profiles (id, email, password_hash, full_name, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::app_role, NOW(), NOW())`,
        [profileId, email, '$2a$10$clM9J17.jlifVSLGXaVTSe3MErkZwTlE6Y/.6RWKBnLqta2ynnAA6', fullName || null, dbRole]
      );

      user = { id: profileId, email, full_name: fullName || null, role: dbRole };
    } else {
      // Update existing user
      profileId = result.rows[0].id;
      await query(
        `UPDATE profiles 
         SET full_name = COALESCE($1, full_name), 
             role = $2::app_role,
             email = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [fullName || null, dbRole, email, profileId]
      );

      user = { 
        id: profileId, 
        email, 
        full_name: fullName || result.rows[0].full_name || null,
        role: dbRole
      };
    }

    // Handle employee record
    // Priority: Check by emp_code first, then by email
    let existingEmployee = null;
    const empByCodeResult = await query(
      'SELECT * FROM employees WHERE emp_code = $1',
      [employeeCode]
    );

    if (empByCodeResult.rows.length > 0) {
      // Employee exists with this emp_code - update it
      existingEmployee = empByCodeResult.rows[0];
      await query(
        `UPDATE employees 
         SET profile_id = $1, email = $2, updated_at = NOW()
         WHERE id = $3`,
        [profileId, email, existingEmployee.id]
      );
    } else {
      // Check by email
      const empByEmailResult = await query(
        'SELECT * FROM employees WHERE email = $1',
        [email]
      );

      if (empByEmailResult.rows.length > 0) {
        // Employee exists with this email but different emp_code
        // Update emp_code if it's not already taken
        existingEmployee = empByEmailResult.rows[0];
        try {
          await query(
            `UPDATE employees 
             SET emp_code = $1, profile_id = $2, updated_at = NOW()
             WHERE id = $3`,
            [employeeCode, profileId, existingEmployee.id]
          );
        } catch (conflictError) {
          // If emp_code conflict, just update profile_id and email
          if (conflictError.message && conflictError.message.includes('emp_code')) {
            console.warn(`[SSO] Emp code ${employeeCode} already exists, updating profile_id only`);
            await query(
              `UPDATE employees SET profile_id = $1, email = $2, updated_at = NOW() WHERE id = $3`,
              [profileId, email, existingEmployee.id]
            );
          } else {
            throw conflictError;
          }
        }
      } else {
        // Create new employee record with minimal data
        const employeeId = uuidv4();
        try {
          await query(
            `INSERT INTO employees (id, emp_code, profile_id, full_name, email, department, 
             business_unit, grade, location, date_of_joining, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'Unassigned', 'Unassigned', 'Unassigned', 'Unassigned', NOW(), NOW(), NOW())`,
            [employeeId, employeeCode, profileId, fullName || 'User', email]
          );
        } catch (conflictError) {
          // Handle conflict on emp_code - update existing record
          if (conflictError.message && conflictError.message.includes('emp_code')) {
            const conflictResult = await query(
              'SELECT * FROM employees WHERE emp_code = $1',
              [employeeCode]
            );
            if (conflictResult.rows.length > 0) {
              existingEmployee = conflictResult.rows[0];
              await query(
                `UPDATE employees SET profile_id = $1, email = $2, updated_at = NOW() WHERE emp_code = $3`,
                  [profileId, email, employeeCode]
              );
            } else {
              throw conflictError;
            }
          } else {
            throw conflictError;
          }
        }
      }
    }


    // Generate token and set cookies
    const token = generateToken(user.id, user.email);
    setAuthCookies(res, token, user);

    // Determine redirect URL - check for frontend origin in headers (from proxy)
    const frontendOrigin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
    const redirectUrl = frontendOrigin && frontendOrigin.includes('localhost:8080') 
      ? `${frontendOrigin}/dashboard` 
      : process.env.FRONTEND_URL 
        ? `${process.env.FRONTEND_URL}/dashboard`
        : '/dashboard';

    // Redirect to dashboard
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('SSO callback error:', error);
    res.redirect('/login?error=sso_failed');
  }
});

// SAML endpoint (placeholder)
router.get('/saml', (req, res) => {
  // In a real implementation, this would initiate SAML authentication
  res.json({
    message: 'SAML SSO endpoint',
    status: 'Configure your SAML provider settings',
    instructions: 'POST to /external-auth/callback with SAML assertion data'
  });
});

// OAuth endpoint (placeholder)
router.get('/oauth', (req, res) => {
  // In a real implementation, this would redirect to OAuth provider
  res.json({
    message: 'OAuth SSO endpoint',
    status: 'Configure your OAuth provider settings',
    instructions: 'POST to /external-auth/callback with OAuth tokens'
  });
});

// OpenID Connect endpoint (placeholder)
router.get('/oidc', (req, res) => {
  // In a real implementation, this would redirect to OIDC provider
  res.json({
    message: 'OpenID Connect SSO endpoint',
    status: 'Configure your OIDC provider settings',
    instructions: 'POST to /external-auth/callback with OIDC tokens'
  });
});

// Token exchange endpoint - for refreshing SSO sessions
router.post('/token/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    // In a real implementation, validate the refresh token with SSO provider
    // and issue new tokens
    
    res.status(501).json({
      error: 'Token refresh not implemented',
      message: 'Configure your SSO provider for token refresh'
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// SSO logout - clear session and optionally call SSO provider logout
router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  
  // In a real implementation, you might also need to call the SSO provider's logout endpoint
  const ssoLogoutUrl = req.body.ssoLogoutUrl;
  
  res.json({
    success: true,
    message: 'Logged out successfully',
    ssoLogoutUrl: ssoLogoutUrl || null
  });
});

router.get('/logout', (req, res) => {
  clearAuthCookies(res);
  res.redirect('/login');
});

export default router;
