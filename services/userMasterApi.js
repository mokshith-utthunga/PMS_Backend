
const USER_MASTER_API_BASE_URL = process.env.USER_MASTER_API_BASE_URL;

export const fetchEmployeeFromUserMaster = async (employeeCode) => {
  if (!employeeCode) {
    console.warn('[UserMasterAPI] Employee code is required');
    return null;
  }

  try {
    const url = `${USER_MASTER_API_BASE_URL}?employee_code=${encodeURIComponent(employeeCode)}`;
    
    console.log(`[UserMasterAPI] Fetching employee data for code: ${employeeCode}`);
    
    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[UserMasterAPI] Employee not found: ${employeeCode}`);
        return null;
      }
      throw new Error(`User Master API returned status ${response.status}`);
    }

    const data = await response.json();
    
    console.log(`[UserMasterAPI] Raw API response for ${employeeCode}:`, JSON.stringify(data, null, 2));
    

    let employeeData = null;
    
    if (Array.isArray(data)) {
      // If response is an array, take the first item
      employeeData = data[0];
    } else if (data.data) {
      employeeData = Array.isArray(data.data) ? data.data[0] : data.data;
    } else if (data.result) {
      employeeData = Array.isArray(data.result) ? data.result[0] : data.result;
    } else {
      employeeData = data;
    }
    
    if (!employeeData) {
      console.warn(`[UserMasterAPI] No employee data found in response for: ${employeeCode}`);
      return null;
    }
    
    if (!employeeData.employeeCode && !employeeData.employee_code) {
      console.warn(`[UserMasterAPI] Invalid response format - no employeeCode found for: ${employeeCode}`);
      console.warn(`[UserMasterAPI] Available keys:`, Object.keys(employeeData));
      return null;
    }

    // Normalize field names (handle both camelCase and snake_case)
    const normalizedData = {
      ...employeeData,
      employeeCode: employeeData.employeeCode || employeeData.employee_code,
      fullName: employeeData.fullName || employeeData.full_name,
      workEmail: employeeData.workEmail || employeeData.work_email || employeeData.email,
      department: employeeData.department,
      subDepartment: employeeData.subDepartment || employeeData.sub_department || employeeData.subDepartment,
      reportingManagerCode: employeeData.reportingManagerCode || employeeData.reporting_manager_code,
      deputedLocation: employeeData.deputedLocation || employeeData.deputed_location || employeeData.location,
      employeeStatus: employeeData.employeeStatus || employeeData.employee_status || employeeData.status,
      dateOfJoining: employeeData.dateOfJoining || employeeData.date_of_joining
    };

    console.log(`[UserMasterAPI] Successfully fetched data for employee: ${employeeCode}`);
    console.log(`[UserMasterAPI] Normalized data structure:`, {
      employeeCode: normalizedData.employeeCode,
      hasDepartment: !!normalizedData.department,
      hasSubDepartment: !!normalizedData.subDepartment,
      hasReportingManagerCode: !!normalizedData.reportingManagerCode,
      department: normalizedData.department,
      subDepartment: normalizedData.subDepartment,
      reportingManagerCode: normalizedData.reportingManagerCode,
      allKeys: Object.keys(employeeData)
    });
    
    return normalizedData;
  } catch (error) {
    // Handle timeout and network errors gracefully
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error(`[UserMasterAPI] Request timeout for employee: ${employeeCode}`);
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error(`[UserMasterAPI] Network error fetching employee: ${employeeCode}`, error.message);
    } else {
      console.error(`[UserMasterAPI] Error fetching employee ${employeeCode}:`, error.message);
    }
    
    // Don't throw - return null to allow login to proceed even if API fails
    return null;
  }
};

export const shouldRefreshEmployeeData = (existingEmployee) => {
  if (!existingEmployee) {
    return true; 
  }
  
  if (existingEmployee.department === 'Unassigned' || 
      existingEmployee.business_unit === 'Unassigned' ||
      !existingEmployee.department ||
      !existingEmployee.sub_department) {
    console.log(`[UserMasterAPI] Employee ${existingEmployee.emp_code} needs refresh - has unassigned values`);
    return true;
  }

  console.log(`[UserMasterAPI] Refreshing employee data for ${existingEmployee.emp_code} on SSO login`);
  return true;

};

export default {
  fetchEmployeeFromUserMaster,
  shouldRefreshEmployeeData
};
